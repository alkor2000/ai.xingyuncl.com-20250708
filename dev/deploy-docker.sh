#!/usr/bin/env bash
# Docker 站点发布（ai.pkuailab.com）。发布路径固定为 WSL → ai.xingyuncl.com（make deploy）→ ai.pkuailab.com（本脚本）：
#   1. 本地检查：工作区干净、在 main、HEAD 已推 GitHub、ai.xingyuncl.com 已发布到同一提交（发布路径顺序）
#   2. 代码到服务器：git bundle + scp，再 ff-only 合并（服务器直连 GitHub 常被掐断，不依赖它）
#   3. 服务器：构建 backend/frontend 镜像并打发布标签、给旧镜像打 rollback 标签、写 release 目录（override + RELEASE.txt）
#   4. 备份数据库 → 用新镜像先跑 knex 迁移（加法式迁移先行）→ 切换容器 → 等 backend healthy → 健康检查
#   5. 清理旧镜像（每个仓库只留最近 3 个发布标签及其 rollback 标签）
#   6. 本地打 deploy-docker-<时间戳> 标签并推送
# 用法: make deploy-docker                 （预览并二次确认）
#       make deploy-docker ARGS=-y         （跳过确认，仅用于自动化）
#       make deploy-docker ARGS=--allow-ahead   （允许 pkuailab 先于 xingyuncl 发布，不推荐）
#       make deploy-docker ARGS=--rebuild  （服务器已在同一提交时仍重新构建切换）
# 环境变量: DOCKER_SSH_HOST=pkuailab  DOCKER_REMOTE_DIR=/var/www/ai-platform  DOCKER_HEALTH_URL=https://ai.pkuailab.com/health
#           PM2_SSH_HOST=practice（用来核对 ai.xingyuncl.com 已发布的提交）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${DOCKER_SSH_HOST:-pkuailab}"
REMOTE_DIR="${DOCKER_REMOTE_DIR:-/var/www/ai-platform}"
HEALTH_URL="${DOCKER_HEALTH_URL:-https://ai.pkuailab.com/health}"
SITE_ORIGIN="${HEALTH_URL%/health}"
PM2_HOST="${PM2_SSH_HOST:-practice}"
KEEP_RELEASES="${DOCKER_KEEP_RELEASES:-3}"
ASSUME_YES=0; ALLOW_AHEAD=0; REBUILD=0
for a in "$@"; do
  case "$a" in
    -y) ASSUME_YES=1 ;;
    --allow-ahead) ALLOW_AHEAD=1 ;;
    --rebuild) REBUILD=1 ;;
    *) echo "未知参数: $a"; exit 1 ;;
  esac
done
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 $SSH_HOST"

cd "$ROOT"

# ---------- 1. 本地检查 ----------
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 本地有未提交改动，请先提交："; git status --short; exit 1
fi
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = main ] || { echo "❌ 请在 main 上发布（当前 $BRANCH）"; exit 1; }
git fetch -q origin
LOCAL_SHA=$(git rev-parse HEAD)
LOCAL_SHORT=$(git rev-parse --short HEAD)
if ! git merge-base --is-ancestor "$LOCAL_SHA" origin/main; then
  echo "❌ HEAD 尚未推送到 GitHub main，请先 git push origin main（GitHub 是代码真相）"; exit 1
fi
PM2_SHA=$(ssh -n -o BatchMode=yes -o ConnectTimeout=20 "$PM2_HOST" "cd $REMOTE_DIR && git rev-parse HEAD" 2>/dev/null || echo unknown)
if [ "$PM2_SHA" != "$LOCAL_SHA" ]; then
  echo "⚠ ai.xingyuncl.com 当前在 ${PM2_SHA:0:7}，不是本提交 $LOCAL_SHORT。发布路径是先 make deploy（xingyuncl）再 make deploy-docker。"
  if [ "$ALLOW_AHEAD" != 1 ]; then echo "   要跳过这个顺序检查：make deploy-docker ARGS=--allow-ahead"; exit 1; fi
fi

# ---------- 2. 服务器状态与代码传输 ----------
REMOTE_SHA=$($SSH "cd $REMOTE_DIR && git rev-parse HEAD")
REMOTE_DIRTY=$($SSH "cd $REMOTE_DIR && git status --porcelain | grep -v '^??' | wc -l")
if [ "$REMOTE_DIRTY" != 0 ]; then
  echo "❌ 服务器工作区有未提交的改动（有人直接改了生产文件），中止："; $SSH "cd $REMOTE_DIR && git status --short | grep -v '^??'"; exit 1
fi
if [ "$REMOTE_SHA" = "$LOCAL_SHA" ] && [ "$REBUILD" != 1 ]; then
  echo "✅ 服务器已在 $LOCAL_SHORT，无需发布（要强制重建：make deploy-docker ARGS=--rebuild）"; exit 0
fi
if ! git cat-file -e "$REMOTE_SHA" 2>/dev/null || ! git merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL_SHA"; then
  echo "❌ 服务器提交 ${REMOTE_SHA:0:7} 不是本地 HEAD 的祖先（服务器分叉或本地不认识它），中止。"; exit 1
fi
echo ""
echo "================ Docker 发布预览（$SSH_HOST）================"
echo "  服务器当前:  ${REMOTE_SHA:0:7}"
echo "  将发布到:    $LOCAL_SHORT"
if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  echo "  变更提交:"; git --no-pager log --oneline "$REMOTE_SHA..$LOCAL_SHA" | sed 's/^/    /'
  echo "  变更文件:"; git --no-pager diff --stat "$REMOTE_SHA..$LOCAL_SHA" | tail -1 | sed 's/^/    /'
  git --no-pager diff --name-only "$REMOTE_SHA..$LOCAL_SHA" | grep -q '^backend/migrations/' && echo "  ⚠ 含 knex 迁移：会在切换容器前用新镜像执行 migrate:latest"
  git --no-pager diff --name-only "$REMOTE_SHA..$LOCAL_SHA" | grep -qE '^(backend|frontend)/package(-lock)?\.json$' && echo "  ⚠ 依赖有变化：镜像构建会重新 npm ci"
fi
echo "=============================================================="
if [ "$ASSUME_YES" != 1 ]; then
  read -rp "确认发布到 ${SITE_ORIGIN#https://}? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "已取消"; exit 1; }
fi

if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  BUNDLE="/tmp/ai-platform-$LOCAL_SHORT.bundle"
  echo "==> 打包 ${REMOTE_SHA:0:7}..$LOCAL_SHORT 并传到服务器 ..."
  git bundle create -q "$BUNDLE" "$REMOTE_SHA..main"
  scp -q -o BatchMode=yes "$BUNDLE" "$SSH_HOST:/var/tmp/"
  rm -f "$BUNDLE"
  $SSH "cd $REMOTE_DIR && git fetch -q /var/tmp/ai-platform-$LOCAL_SHORT.bundle main && git merge -q --ff-only FETCH_HEAD && rm -f /var/tmp/ai-platform-$LOCAL_SHORT.bundle && echo \"    服务器现在位于: \$(git rev-parse --short HEAD)\""
fi

# ---------- 3–5. 服务器上构建、备份、迁移、切换、清理 ----------
echo "==> 服务器构建镜像并切换 ..."
REMOTE_LOG="$(mktemp)"
$SSH bash -s "$REMOTE_DIR" "$LOCAL_SHORT" "$KEEP_RELEASES" <<'REMOTE' | tee "$REMOTE_LOG"
set -euo pipefail
REMOTE_DIR="$1"; SHORT="$2"; KEEP="$3"
cd "$REMOTE_DIR"
TS=$(date +%Y%m%d_%H%M%S)
TAG="v-${SHORT}-${TS}"
REL="/var/backups/ai-platform/releases/ai-platform-${TAG}"
mkdir -p "$REL" /var/backups/ai-platform/mysql
OLD_B=$(docker inspect ai-platform-backend --format '{{.Config.Image}}' 2>/dev/null || echo none)
OLD_F=$(docker inspect ai-platform-frontend --format '{{.Config.Image}}' 2>/dev/null || echo none)
# 回滚标签按镜像 ID 打，而不是按标签名：正在跑的容器的标签可能已被清理掉（2026-09-15 出过 "No such image"）
OLD_B_ID=$(docker inspect ai-platform-backend --format '{{.Image}}' 2>/dev/null || echo none)
OLD_F_ID=$(docker inspect ai-platform-frontend --format '{{.Image}}' 2>/dev/null || echo none)

AVAIL_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ "${AVAIL_GB:-0}" -lt 8 ]; then echo "    磁盘剩余 ${AVAIL_GB}G，先清构建缓存 ..."; docker builder prune -af >/dev/null; fi
echo "    docker compose build backend frontend（日志 $REL/build.log）..."
if ! docker compose build backend frontend </dev/null > "$REL/build.log" 2>&1; then
  echo "❌ 镜像构建失败，最后 40 行："; tail -40 "$REL/build.log"; exit 1
fi
docker tag ai-platform-backend:latest  "ai-platform-backend:${TAG}"
docker tag ai-platform-frontend:latest "ai-platform-frontend:${TAG}"
[ "$OLD_B_ID" != none ] && docker tag "$OLD_B_ID" "ai-platform-backend:rollback-${TS}"
[ "$OLD_F_ID" != none ] && docker tag "$OLD_F_ID" "ai-platform-frontend:rollback-${TS}"
cat > "$REL/release.override.yml" <<YML
services:
  backend:
    image: ai-platform-backend:${TAG}
  frontend:
    image: ai-platform-frontend:${TAG}
YML
# 回滚用：指向本次发布前正在运行的镜像（rollback-<TS> 标签按镜像 ID 打，不受旧标签被清理影响）
if [ "$OLD_B_ID" != none ] && [ "$OLD_F_ID" != none ]; then
cat > "$REL/rollback.override.yml" <<YML
services:
  backend:
    image: ai-platform-backend:rollback-${TS}
  frontend:
    image: ai-platform-frontend:rollback-${TS}
YML
fi
{
  echo "TASK_ID=deploy-docker"
  echo "RELEASE_TIME=$TS"
  echo "SOURCE_COMMIT=$(git rev-parse HEAD)"
  echo "PREVIOUS_BACKEND_TAG=$OLD_B"
  echo "PREVIOUS_FRONTEND_TAG=$OLD_F"
  echo "CANDIDATE_TAG=$TAG"
  echo "ROLLBACK_TAG=rollback-$TS"
} > "$REL/RELEASE.txt"
ln -sfn "$REL" /var/backups/ai-platform/releases/current

echo "    备份数据库 ..."
BK="/var/backups/ai-platform/mysql/ai_platform-${TS}.sql.gz"
docker exec ai-platform-mysql sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --quick "$MYSQL_DATABASE" 2>/dev/null' | gzip > "$BK"
[ -s "$BK" ] || { echo "❌ 备份为空，中止"; exit 1; }
echo "    备份: $BK ($(du -h "$BK" | cut -f1))"; echo "DB_BACKUP=$BK" >> "$REL/RELEASE.txt"

echo "    用新镜像执行 knex 迁移（切换前）..."
# 注意：本段脚本经 stdin 喂给远端 bash -s，任何会读 stdin 的命令都必须 </dev/null，否则会把脚本剩余部分吃掉
docker compose -f docker-compose.yml -f "$REL/release.override.yml" run --rm --no-deps -T backend npx knex migrate:latest </dev/null 2>&1 | grep -vE '^$|Using environment|attribute .version. is obsolete' | sed 's/^/      /' || { echo "❌ 迁移失败，容器未切换；库已备份到 $BK"; exit 1; }

echo "    切换容器 ..."
docker compose -f docker-compose.yml -f "$REL/release.override.yml" up -d backend frontend </dev/null >/dev/null 2>&1
STATUS=starting
for i in $(seq 1 36); do
  STATUS=$(docker inspect ai-platform-backend --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  [ "$STATUS" = healthy ] && break; sleep 5
done
if [ "$STATUS" != healthy ]; then
  echo "❌ backend 3 分钟内未 healthy（$STATUS）。回滚命令："
  echo "   docker compose -f $REMOTE_DIR/docker-compose.yml -f $REL/rollback.override.yml up -d backend frontend"
  docker logs --tail 40 ai-platform-backend 2>&1 | cut -c1-160; exit 1
fi
L=$(docker logs ai-platform-backend 2>&1 || true)
echo "    启动脚本 SQL 迁移：执行 $(echo "$L" | grep -c '^执行迁移' || true) 跳过 $(echo "$L" | grep -c '跳过已执行' || true) 失败 $(echo "$L" | grep -c '执行失败' || true)"
docker ps --format '    {{.Names}}  {{.Image}}  {{.Status}}' | grep ai-platform
echo "FINAL_STATUS=RELEASED" >> "$REL/RELEASE.txt"

echo "    清理旧镜像（每个仓库保留最近 $KEEP 个发布及其 rollback；正在运行的镜像永远不删）..."
# 标签形如 v-<sha>-<YYYYmmdd_HHMMSS> / rollback-<YYYYmmdd_HHMMSS>：按末尾 15 位完整时间戳倒序才是按时间。
# 以前按 "_" 后的时分秒排序，把当天凌晨发布的当成最旧删掉了，连正在跑的容器的标签都被清掉
RUN_IDS="$(docker inspect ai-platform-backend ai-platform-frontend --format '{{.Image}}' 2>/dev/null || true)"
for repo in ai-platform-backend ai-platform-frontend; do
  for pat in '^v-' '^rollback-'; do
    docker images --format '{{.Tag}}' "$repo" | grep -E "$pat" | awk '{ print substr($0, length($0) - 14) "\t" $0 }' | sort -r | cut -f2 | tail -n +$((KEEP + 1)) | while read -r t; do
      id=$(docker image inspect "$repo:$t" --format '{{.Id}}' 2>/dev/null || true)
      [ -n "$id" ] && echo "$RUN_IDS" | grep -q "$id" && continue
      docker rmi "$repo:$t" >/dev/null 2>&1 || true
    done
  done
done
docker image prune -f >/dev/null 2>&1 || true
echo "    磁盘: $(df -h / | tail -1 | awk '{print $5" 已用，剩 "$4}')"
echo "    发布目录: $REL"
echo "REMOTE_DONE"
REMOTE

grep -q '^REMOTE_DONE$' "$REMOTE_LOG" || { echo "❌ 服务器端脚本没有执行到底（容器可能没有切换），请看上面的输出与 make status-docker"; rm -f "$REMOTE_LOG"; exit 1; }
rm -f "$REMOTE_LOG"
if ! $SSH "docker inspect ai-platform-backend --format '{{.Config.Image}}'" | grep -q "v-$LOCAL_SHORT-"; then
  echo "❌ 服务器 backend 容器没有运行本次镜像，请看 make status-docker"; exit 1
fi

# ---------- 6. 本地标签与线上健康检查 ----------
TAG="deploy-docker-$(date +%Y%m%d_%H%M%S)"
git tag -a "$TAG" -m "deploy $LOCAL_SHORT to $SSH_HOST (docker)"
git push -q origin "$TAG" 2>/dev/null || echo "⚠ tag 推送失败（本地已打 $TAG）"
echo ""
echo "✅ Docker 发布完成，已打标签 $TAG"
echo "   线上健康检查:"; curl -sf -m 15 "$HEALTH_URL" && echo || { echo "❌ 健康检查失败"; exit 1; }
for u in /api/ai-lab/tasks /login; do printf "   %-22s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$SITE_ORIGIN$u")"; done
