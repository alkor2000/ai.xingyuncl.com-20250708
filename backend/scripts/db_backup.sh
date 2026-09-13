#!/usr/bin/env bash
# 实践平台数据库备份（在生产机上运行）。
# 连接信息只从 backend/.env 读取（安全解析，不 source、不打印），stdout 只输出生成的 .sql.gz 路径，
# 同目录生成同名 .sha256。dev/db-pull.sh 与 dev/deploy.sh 的发布前备份门都调用本脚本。
#
# 用法（服务器）: bash backend/scripts/db_backup.sh
# 环境变量:      APP_DIR   项目根（默认 /var/www/ai-platform）
#               DB        库名（默认取 .env 的 DB_NAME）
#               KEEP      保留份数（默认 14）
#               BACKUP_DIR 输出目录（默认 /var/backups/ai-platform/mysql）
set -euo pipefail
APP_DIR="${APP_DIR:-/var/www/ai-platform}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ai-platform/mysql}"
KEEP="${KEEP:-14}"
ENV_FILE="$APP_DIR/backend/.env"
[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE" >&2; exit 1; }

# dotenv 风格取值：取最后一次赋值，去掉行尾注释（空白+#）与成对引号。值不经 shell 求值。
envget() {
  sed -nE "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" | tail -n1 \
    | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}
DB="${DB:-$(envget DB_NAME)}"; DB="${DB:-ai_platform}"
H="$(envget DB_HOST)"; H="${H:-127.0.0.1}"; [ "$H" = localhost ] && H=127.0.0.1
P="$(envget DB_PORT)"; P="${P:-3306}"
U="$(envget DB_USER)"; [ -n "$U" ] || { echo ".env 缺少 DB_USER" >&2; exit 1; }
PW="$(envget DB_PASSWORD)"; [ -n "$PW" ] || { echo ".env 缺少 DB_PASSWORD" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
TS=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/${DB}-${TS}.sql.gz"
TMP="$OUT.part"
# --single-transaction 不锁表；--no-tablespaces 免 PROCESS 权限；例程/触发器随库走
MYSQL_PWD="$PW" mysqldump -h "$H" -P "$P" -u "$U" --single-transaction --quick --routines --triggers \
  --default-character-set=utf8mb4 --set-gtid-purged=OFF --no-tablespaces "$DB" \
  | gzip -6 > "$TMP"
gzip -t "$TMP"
mv "$TMP" "$OUT"; chmod 600 "$OUT"
sha256sum "$OUT" | awk '{print $1}' > "$OUT.sha256"
# 只保留最近 KEEP 份
ls -t "$BACKUP_DIR"/"${DB}"-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f" "$f.sha256"; done || true
echo "$OUT"
