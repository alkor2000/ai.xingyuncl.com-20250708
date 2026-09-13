#!/usr/bin/env bash
# 把线上 ai_platform 库拉到本地 Docker MySQL（本地库整体覆盖），并按其结构重建 ai_platform_test 供集成测试。
#
# 用法（仓库根目录）：
#   make db-pull                    # 服务器上生成新 dump → 经 lab 中转下载 → 校验 → 导入
#   dev/db-pull.sh --reuse-latest   # 不重新 dump，用服务器上最新的一份
#   RELAY=none dev/db-pull.sh       # 不经 lab 中转直连下载（practice→本机直连约 100KB/s，仅小库可用）
#
# 数据只从线上流向本地；本地库随时可以丢弃重拉。结构变更通过 knex 迁移随发布流向线上，
# 绝不把本地 dump 导回线上。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST=${SSH_HOST:-practice}
RELAY=${RELAY:-lab}
DUMP_DIR=${DUMP_DIR:-$HOME/db-dumps}
CONTAINER=${CONTAINER:-practice-mysql}
ROOT_PW=${DEV_MYSQL_ROOT_PASSWORD:-devroot}
DB=${DB:-ai_platform}
TEST_DB=${TEST_DB:-ai_platform_test}
REMOTE_APP_DIR=${REMOTE_APP_DIR:-/var/www/ai-platform}
REMOTE_BACKUP_DIR=${REMOTE_BACKUP_DIR:-/var/backups/ai-platform/mysql}
ENV_FILE="$ROOT/backend/.env"

REUSE=0
for a in "$@"; do
  case "$a" in
    --reuse-latest) REUSE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "未知参数: $a" >&2; exit 2 ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE（先从 ~/practice-sync/mirror/backend.env 复制并改本地值）" >&2; exit 1; }
DB_USER=$(sed -nE 's/^[[:space:]]*DB_USER[[:space:]]*=//p' "$ENV_FILE" | tail -1 | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/')
[ -n "$DB_USER" ] || { echo "backend/.env 缺少 DB_USER" >&2; exit 1; }

if ! docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null | grep -q healthy; then
  echo "本地 MySQL 容器 $CONTAINER 未运行或未就绪，先执行 make db-up" >&2; exit 1
fi
mkdir -p "$DUMP_DIR"
T0=$(date +%s)
mysql_root() { docker exec -i "$CONTAINER" mysql -uroot -p"$ROOT_PW" "$@" 2> >(grep -v 'Using a password' >&2 || true); }

# 1. 服务器上生成 dump（脚本经 stdin 送达，不要求服务器上已部署该脚本）
if [ "$REUSE" = 1 ]; then
  REMOTE=$(ssh -n -o BatchMode=yes "$SSH_HOST" "ls -t $REMOTE_BACKUP_DIR/$DB-*.sql.gz | head -1")
  echo "[1/5] 使用服务器上现有 dump: $REMOTE"
else
  echo "[1/5] 服务器上生成新 dump（--single-transaction，不锁表）..."
  REMOTE=$(ssh -o BatchMode=yes "$SSH_HOST" "APP_DIR=$REMOTE_APP_DIR DB=$DB bash -s" < "$ROOT/backend/scripts/db_backup.sh")
fi
[ -n "$REMOTE" ] || { echo "没有拿到 dump 路径" >&2; exit 1; }
LOCAL="$DUMP_DIR/$(basename "$REMOTE")"

# 2. 下载（默认经 lab 中转：practice→lab 约 6MB/s，lab→本机约 16MB/s；直连只有约 100KB/s）
if [ "$RELAY" = none ]; then
  echo "[2/5] 直连下载到 $LOCAL ..."
  rsync -a --info=progress2 "$SSH_HOST:$REMOTE" "$LOCAL"
else
  echo "[2/5] 经 $RELAY 中转下载到 $LOCAL ..."
  AGENT_STARTED=0
  if ! ssh-add -l >/dev/null 2>&1; then eval "$(ssh-agent -s)" >/dev/null; ssh-add ~/.ssh/id_ed25519 >/dev/null 2>&1; AGENT_STARTED=1; fi
  PRACTICE_ADDR=$(ssh -G "$SSH_HOST" | awk '/^hostname /{print $2}')
  PRACTICE_USER=$(ssh -G "$SSH_HOST" | awk '/^user /{print $2}')
  ssh -A -n -o BatchMode=yes "$RELAY" "mkdir -p /root/practice-relay/db && rsync -a -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' $PRACTICE_USER@$PRACTICE_ADDR:$REMOTE $PRACTICE_USER@$PRACTICE_ADDR:$REMOTE.sha256 /root/practice-relay/db/"
  rsync -a --info=progress2 "$RELAY:/root/practice-relay/db/$(basename "$REMOTE")" "$LOCAL"
  [ "$AGENT_STARTED" = 1 ] && ssh-agent -k >/dev/null 2>&1 || true
fi
EXPECTED=$(ssh -n -o BatchMode=yes "$SSH_HOST" "cat $REMOTE.sha256 2>/dev/null" | awk '{print $1}')
if [ -n "$EXPECTED" ]; then
  ACTUAL=$(sha256sum "$LOCAL" | awk '{print $1}')
  [ "$EXPECTED" = "$ACTUAL" ] || { echo "sha256 不匹配，下载损坏" >&2; exit 1; }
  echo "      sha256 校验通过"
fi
gzip -t "$LOCAL"

# 3. 重建本地库并导入（去掉 DEFINER，避免线上账号名不存在导致视图/触发器报错）
echo "[3/5] 重建本地库 $DB ..."
mysql_root -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON \`$DB\`.* TO '$DB_USER'@'%'; GRANT ALL ON \`$TEST_DB\`.* TO '$DB_USER'@'%'; FLUSH PRIVILEGES;"
echo "[4/5] 导入 ..."
if command -v pv >/dev/null 2>&1; then READER="pv"; else READER="cat"; fi
$READER "$LOCAL" | gunzip -c | sed -E 's/DEFINER=`[^`]*`@`[^`]*`//g' \
  | mysql_root --init-command="SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0;" "$DB"

# 4. 测试库：只复制结构（集成测试自己造数据、自己清理）
echo "[5/5] 重建测试库 $TEST_DB（仅结构）..."
mysql_root -e "DROP DATABASE IF EXISTS \`$TEST_DB\`; CREATE DATABASE \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
docker exec "$CONTAINER" mysqldump -uroot -p"$ROOT_PW" --no-data --routines --triggers "$DB" 2>/dev/null \
  | sed -E 's/DEFINER=`[^`]*`@`[^`]*`//g' | mysql_root "$TEST_DB"

TABLES=$(mysql_root -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB'")
SIZE=$(mysql_root -N -e "SELECT ROUND(SUM(data_length+index_length)/1024/1024,1) FROM information_schema.tables WHERE table_schema='$DB'")
TTABLES=$(mysql_root -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_DB'")
echo "完成：$DB $TABLES 张表约 ${SIZE} MB，$TEST_DB $TTABLES 张表（空），用时 $(( $(date +%s) - T0 )) 秒。dump 保留在 $LOCAL"
# 只保留最近 3 份本地 dump
ls -t "$DUMP_DIR"/"$DB"-*.sql.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
