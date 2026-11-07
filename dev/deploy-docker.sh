#!/usr/bin/env bash
# Docker 站点发布（ai.pkuailab.com）。发布路径固定为 WSL → ai.xingyuncl.com（make deploy）→ ai.pkuailab.com（本脚本）：
#   1. 本地检查：工作区干净、在 main、HEAD 已推 GitHub、ai.xingyuncl.com 已发布到同一提交（发布路径顺序）
#   2. 代码到服务器：git bundle + scp，再 ff-only 合并（服务器直连 GitHub 常被掐断，不依赖它）
#   3. 服务器：资源复核后依次构建 backend/frontend 镜像并打发布标签、给旧镜像打 rollback 标签、写 release 目录（override + RELEASE.txt）
#      --prebuilt=<包目录> 时不构建：核对 make build-images 取回的镜像包（摘要、源码提交、平台、构建参数），传到服务器校验后
#      docker load，逐镜像核对 ID/平台/CUSTOMER_DOMAIN 才往下走；这条路径里服务器永远不会 docker compose build
#   4. 备份数据库 → 用新镜像先跑 knex 迁移（加法式迁移先行）→ 切换容器 → 等 backend healthy → 健康检查
#   5. 清理旧镜像（每个仓库只留最近 3 个发布标签及其 rollback 标签）和旧库备份（只留最近 7 份，切换成功后才删）
#   6. 本地打 deploy-docker-<时间戳> 标签并推送
# 两种模式都先在服务器拿唯一发布锁（/var/backups/ai-platform/releases/.lock，dev/docker-release-lock.sh），拿不到即拒绝。
# 用法: make deploy-docker                 （预览并二次确认）
#       make deploy-docker ARGS=-y         （跳过确认，仅用于自动化）
#       make deploy-docker ARGS=--allow-ahead   （允许 pkuailab 先于 xingyuncl 发布，不推荐）
#       make deploy-docker ARGS=--rebuild  （服务器已在同一提交时仍重新构建/加载并切换）
#       make deploy-docker ARGS=--prebuilt=/home/you/ai-platform-images/v-<短sha>-<时间戳>  （加载 make build-images 的镜像包，不在站点构建）
#       make deploy-docker ARGS="--prebuilt=<包目录> --code-only"  （纯代码发布：不跑 knex、容器启动不跑 SQL 迁移脚本、不清理旧镜像和旧库备份；其余门不变，见 dev/RELEASE.md 第七节）
# 环境变量: DOCKER_SSH_HOST=pkuailab  DOCKER_REMOTE_DIR=/var/www/ai-platform  DOCKER_HEALTH_URL=https://ai.pkuailab.com/health
#           PM2_SSH_HOST=practice（用来核对 ai.xingyuncl.com 已发布的提交）
#           DOCKER_MIN_FREE_GIB=8 DOCKER_MIN_AVAILABLE_MIB=5120 DOCKER_MIN_FREE_INODES=100000（现场构建的门）
#           DOCKER_PREBUILT_DISK_MARGIN_GIB=2 DOCKER_PREBUILT_MIN_AVAILABLE_MIB=1024（预构建路径的门：磁盘 ≥ tar + 两镜像 + 余量，内存只看运行余量）
#           DOCKER_KEEP_DB_BACKUPS=7（保留的库备份份数，至少 1）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${DOCKER_SSH_HOST:-pkuailab}"
REMOTE_DIR="${DOCKER_REMOTE_DIR:-/var/www/ai-platform}"
HEALTH_URL="${DOCKER_HEALTH_URL:-https://ai.pkuailab.com/health}"
SITE_ORIGIN="${HEALTH_URL%/health}"
SITE_HOST="${SITE_ORIGIN#https://}"; SITE_HOST="${SITE_HOST#http://}"; SITE_HOST="${SITE_HOST%%/*}"
PM2_HOST="${PM2_SSH_HOST:-practice}"
KEEP_RELEASES="${DOCKER_KEEP_RELEASES:-3}"
MIN_FREE_GIB="${DOCKER_MIN_FREE_GIB:-8}"
MIN_AVAILABLE_MIB="${DOCKER_MIN_AVAILABLE_MIB:-5120}"
MIN_FREE_INODES="${DOCKER_MIN_FREE_INODES:-100000}"
PREBUILT_DISK_MARGIN_GIB="${DOCKER_PREBUILT_DISK_MARGIN_GIB:-2}"
PREBUILT_MIN_AVAILABLE_MIB="${DOCKER_PREBUILT_MIN_AVAILABLE_MIB:-1024}"
KEEP_DB_BACKUPS="${DOCKER_KEEP_DB_BACKUPS:-7}"
LOCK_DIR="/var/backups/ai-platform/releases/.lock"
# 0 或非数字会让清理删光全部备份，动手前就拒绝。
[[ "$KEEP_DB_BACKUPS" =~ ^[1-9][0-9]*$ ]] || { echo "❌ DOCKER_KEEP_DB_BACKUPS 必须是正整数（当前: $KEEP_DB_BACKUPS）"; exit 1; }
for v in "$PREBUILT_DISK_MARGIN_GIB" "$PREBUILT_MIN_AVAILABLE_MIB"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "❌ DOCKER_PREBUILT_* 阈值必须是非负整数（当前: $v）"; exit 1; }
done
ASSUME_YES=0; ALLOW_AHEAD=0; REBUILD=0; PKG_DIR=""; MODE=build; CODE_ONLY=0
# 纯代码发布不许包含的路径：会碰库、或会改容器启动方式的文件。
CODE_ONLY_FORBIDDEN='^(backend/migrations/|backend/knexfile\.js$|database/|tools/database-upgrade/|docker/|docker-compose\.yml$)'
for a in "$@"; do
  case "$a" in
    -y) ASSUME_YES=1 ;;
    --allow-ahead) ALLOW_AHEAD=1 ;;
    --rebuild) REBUILD=1 ;;
    --prebuilt=*) PKG_DIR="${a#--prebuilt=}"; MODE=prebuilt ;;
    --code-only) CODE_ONLY=1 ;;
    *) echo "未知参数: $a"; exit 1 ;;
  esac
done
if [ "$CODE_ONLY" = 1 ] && [ "$MODE" != prebuilt ]; then
  echo "❌ --code-only 只能和 --prebuilt=<包目录> 一起用（Docker 站点的发布路线是预构建镜像）"; exit 1
fi
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 $SSH_HOST"
PREFLIGHT="$ROOT/dev/docker-release-preflight.sh"
LOCKSH="$ROOT/dev/docker-release-lock.sh"

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

# ---------- 1b. 预构建镜像包（本地核对，任何连接之前） ----------
TASK=""; TAR_SHA256=""; TAR_SIZE=0; BACKEND_IMAGE_ID=""; FRONTEND_IMAGE_ID=""; IMAGE_PLATFORM=""; GATE_LABEL=build
GATE_FREE_GIB="$MIN_FREE_GIB"; GATE_AVAILABLE_MIB="$MIN_AVAILABLE_MIB"
if [ "$MODE" = prebuilt ]; then
  [ -d "$PKG_DIR" ] || { echo "❌ 镜像包目录不存在: $PKG_DIR"; exit 1; }
  PKG_DIR="$(cd "$PKG_DIR" && pwd)"
  [ -f "$PKG_DIR/MANIFEST.env" ] && [ -f "$PKG_DIR/images.tar.gz" ] || { echo "❌ 镜像包不完整：需要 $PKG_DIR/MANIFEST.env 与 images.tar.gz（由 make build-images 生成）"; exit 1; }
  manifest_value() { # KEY REGEX → 值；缺失或格式不对返回 1
    local v; v=$(grep -E "^$1=" "$PKG_DIR/MANIFEST.env" | head -1 | cut -d= -f2-)
    [[ "$v" =~ $2 ]] || { echo "❌ 镜像包清单 $1 缺失或格式不对: '${v:-<空>}'" >&2; return 1; }
    printf '%s' "$v"
  }
  TASK=$(manifest_value TASK '^v-[0-9a-f]{7,12}-[0-9]{8}_[0-9]{6}$') || exit 1
  SOURCE_COMMIT=$(manifest_value SOURCE_COMMIT '^[0-9a-f]{40}$') || exit 1
  TAR_SHA256=$(manifest_value TAR_SHA256 '^[0-9a-f]{64}$') || exit 1
  TAR_SIZE=$(manifest_value TAR_SIZE '^[0-9]+$') || exit 1
  BACKEND_IMAGE_ID=$(manifest_value BACKEND_IMAGE_ID '^sha256:[0-9a-f]{64}$') || exit 1
  FRONTEND_IMAGE_ID=$(manifest_value FRONTEND_IMAGE_ID '^sha256:[0-9a-f]{64}$') || exit 1
  BACKEND_IMAGE_SIZE=$(manifest_value BACKEND_IMAGE_SIZE '^[0-9]+$') || exit 1
  FRONTEND_IMAGE_SIZE=$(manifest_value FRONTEND_IMAGE_SIZE '^[0-9]+$') || exit 1
  IMAGE_PLATFORM=$(manifest_value IMAGE_PLATFORM '^linux/(amd64|arm64)$') || exit 1
  PKG_DOMAIN=$(manifest_value CUSTOMER_DOMAIN_BUILD_ARG '^[A-Za-z0-9.-]+$') || exit 1
  BACKEND_TAG=$(manifest_value BACKEND_IMAGE_TAG '^ai-platform-backend:v-') || exit 1
  FRONTEND_TAG=$(manifest_value FRONTEND_IMAGE_TAG '^ai-platform-frontend:v-') || exit 1
  [ "$BACKEND_TAG" = "ai-platform-backend:$TASK" ] && [ "$FRONTEND_TAG" = "ai-platform-frontend:$TASK" ] || { echo "❌ 清单里的镜像标签与任务号 $TASK 不一致"; exit 1; }
  if [ "$SOURCE_COMMIT" != "$LOCAL_SHA" ]; then
    echo "❌ 镜像包是 ${SOURCE_COMMIT:0:7} 构建的，不是本地 HEAD $LOCAL_SHORT：错提交不发。要发这个包就把本地切到那个提交；要发 HEAD 就重新 make build-images。"; exit 1
  fi
  if [ "$PKG_DOMAIN" != "$SITE_HOST" ]; then
    echo "❌ 镜像包 frontend 的 CUSTOMER_DOMAIN 构建参数是 $PKG_DOMAIN，不是本站点 $SITE_HOST：不能把别的站点的镜像发到这里。"; exit 1
  fi
  ACTUAL_SIZE=$(stat -c %s "$PKG_DIR/images.tar.gz")
  [ "$ACTUAL_SIZE" = "$TAR_SIZE" ] || { echo "❌ 本地 images.tar.gz 大小 $ACTUAL_SIZE ≠ 清单 $TAR_SIZE（包不完整或被改）"; exit 1; }
  ACTUAL_SHA=$(sha256sum "$PKG_DIR/images.tar.gz" | cut -d' ' -f1)
  [ "$ACTUAL_SHA" = "$TAR_SHA256" ] || { echo "❌ 本地 images.tar.gz 摘要 $ACTUAL_SHA ≠ 清单 $TAR_SHA256（包损坏或被改）"; exit 1; }
  # 预构建路径的门：磁盘 = 包 + 两镜像解包 + 余量（库备份约 0.4 GB、发布目录与日志、1 GiB 底）；内存只看运行余量（迁移一次性容器 + 新旧容器交接约 150–300 MiB，取两倍再取整）
  NEED_BYTES=$(( TAR_SIZE + BACKEND_IMAGE_SIZE + FRONTEND_IMAGE_SIZE + PREBUILT_DISK_MARGIN_GIB * 1073741824 ))
  GATE_FREE_GIB=$(( (NEED_BYTES + 1073741823) / 1073741824 ))
  GATE_AVAILABLE_MIB="$PREBUILT_MIN_AVAILABLE_MIB"
  GATE_LABEL=prebuilt
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
  RUNTIME=$($SSH bash -s -- runtime "$LOCAL_SHORT" < "$PREFLIGHT")
  if [ "$RUNTIME" = CURRENT ] && curl -sf -m 15 "$HEALTH_URL" >/dev/null; then
    echo "✅ 代码、双容器镜像及健康检查均为 $LOCAL_SHORT，无需发布"; exit 0
  fi
  echo "⚠ Git 已在目标提交，但运行容器或健康检查未达到该版本，继续走确认、构建与切换：$RUNTIME"
fi
if ! git cat-file -e "$REMOTE_SHA" 2>/dev/null || ! git merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL_SHA"; then
  echo "❌ 服务器提交 ${REMOTE_SHA:0:7} 不是本地 HEAD 的祖先（服务器分叉或本地不认识它），中止。"; exit 1
fi
# 纯代码发布的前提，在拿锁和传任何东西之前核完。差量基准是"正在运行的封存父版"，不是服务器 Git HEAD：
# Git HEAD 不代表运行中的镜像，传码后中断再重跑时它已经等于目标提交，拿它算差量永远是空的。
PARENT_SHA=""; PARENT_IDENTITY=""
if [ "$CODE_ONLY" = 1 ]; then
  if ! PARENT_LINE=$($SSH bash -s -- sealed-parent < "$PREFLIGHT" 2>&1); then
    echo "❌ --code-only 要求运行中的版本就是发布记录封存的父版，当前不成立，中止："; echo "$PARENT_LINE" | sed 's/^/    /'; exit 1
  fi
  PARENT_IDENTITY=$(grep -m1 '^parent=' <<<"$PARENT_LINE" || true)
  PARENT_SHA=$(sed -n 's/^parent=\([0-9a-f]\{40\}\) .*/\1/p' <<<"$PARENT_IDENTITY")
  if [ -z "$PARENT_SHA" ] || ! git cat-file -e "$PARENT_SHA" 2>/dev/null || ! git merge-base --is-ancestor "$PARENT_SHA" "$LOCAL_SHA"; then
    echo "❌ 封存父版（${PARENT_LINE}）读不出来或不是本地 HEAD 的祖先，中止。"; exit 1
  fi
  NOT_CODE=$(git --no-pager diff --no-renames --name-only "$PARENT_SHA" "$LOCAL_SHA" | grep -E "$CODE_ONLY_FORBIDDEN" || true)
  if [ -n "$NOT_CODE" ]; then
    echo "❌ --code-only 只发纯代码。父版 ${PARENT_SHA:0:7} 到本提交之间有这些会碰库或改启动方式的文件，请走常规发布："; echo "$NOT_CODE" | sed 's/^/    /'; exit 1
  fi
fi
REMOTE_PLATFORM=""
if [ "$MODE" = prebuilt ]; then
  REMOTE_PLATFORM=$($SSH bash -s -- arch < "$PREFLIGHT" 2>/dev/null || echo unknown)
  if [ "$REMOTE_PLATFORM" != "$IMAGE_PLATFORM" ]; then
    echo "❌ 服务器 Docker 平台 $REMOTE_PLATFORM 与镜像包平台 $IMAGE_PLATFORM 不同（或读不到）：错架构不加载。"; exit 1
  fi
  # 现场构建会把服务器检出里的未跟踪文件（如门户页 frontend/public/www/）COPY 进镜像，预构建镜像里没有：先列出来，由人决定提交进仓或改挂载，不让它们在切换时消失。
  # 判定用的"保留合同"是本地 HEAD（即将发布的那份）docker-compose.yml 里以 ./ 挂载的宿主目录，而不是服务器上传码前的旧 compose：
  # 首次加挂载的升级时旧 compose 还没有那一行，用它判定会把自己拦住；而本地 HEAD 的 compose 已在本地核过，就是切换后真正生效的那份。
  TARGET_MOUNTS=$(git show HEAD:docker-compose.yml | grep -oE '^\s*-\s*\./[A-Za-z0-9._/-]+:' | sed -E 's/^\s*-\s*\.\///; s/:$//; s/\/+$//' | paste -sd, -)
  [ -n "$TARGET_MOUNTS" ] || TARGET_MOUNTS=-
  if ! UNTRACKED=$($SSH bash -s -- untracked-context "$REMOTE_DIR" "$TARGET_MOUNTS" < "$PREFLIGHT" 2>&1); then
    echo "❌ 服务器检出里有会被构建进镜像、且目标 compose 没有挂载的未跟踪文件，预构建镜像不含它们，中止："; echo "$UNTRACKED" | sed 's/^/    /'
    echo "   目标 compose（本地 HEAD）挂载的宿主目录：${TARGET_MOUNTS}"
    echo "   处理办法：把这些内容提交进仓库后重新 make build-images，或在 compose 里改成挂载；不要让它们随切换消失。"; exit 1
  fi
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
if [ "$MODE" = prebuilt ]; then
  echo "  镜像来源:    预构建包 $TASK（$PKG_DIR，$(( TAR_SIZE / 1048576 )) MiB，sha256 ${TAR_SHA256:0:16}…）"
  echo "               backend ${BACKEND_IMAGE_ID:0:19}… ($(( BACKEND_IMAGE_SIZE / 1048576 )) MiB)  frontend ${FRONTEND_IMAGE_ID:0:19}… ($(( FRONTEND_IMAGE_SIZE / 1048576 )) MiB)  平台 $IMAGE_PLATFORM = 服务器 $REMOTE_PLATFORM"
  echo "  资源门:      磁盘 ≥ ${GATE_FREE_GIB} GiB（包 + 两镜像 + ${PREBUILT_DISK_MARGIN_GIB} GiB 余量）、可用内存 ≥ ${GATE_AVAILABLE_MIB} MiB（运行余量）、inode ≥ ${MIN_FREE_INODES}；服务器只加载、不构建"
  echo "  保留合同:    服务器未跟踪的构建输入已按目标 compose 的挂载判定（${TARGET_MOUNTS}），无遗漏"
else
  echo "  镜像来源:    服务器现场 docker compose build（资源门 ≥ ${GATE_FREE_GIB} GiB、≥ ${GATE_AVAILABLE_MIB} MiB、≥ ${MIN_FREE_INODES} inode）"
fi
if [ "$CODE_ONLY" = 1 ]; then
  echo "  发布方式:    纯代码（--code-only）：不跑 knex；容器启动不跑 SQL 迁移脚本；不清理旧镜像和旧库备份"
  echo "               照旧保留：确认、发布锁、资源门、包与镜像核验、发布前库备份、回退标签、健康检查"
  echo "  封存父版:    ${PARENT_SHA:0:7}（运行镜像 = 发布记录 = 镜像清单）；到本提交的差量不含迁移与启动文件"
fi
echo "=============================================================="
if [ "$ASSUME_YES" != 1 ]; then
  read -rp "确认发布到 ${SITE_ORIGIN#https://}? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "已取消"; exit 1; }
fi

# 唯一发布锁：任何服务器写入（传码、传包、构建、加载、切换）之前拿到；拿不到就是有别的发布在跑，拒绝。
LOCK_TOKEN="deploy-$(date +%Y%m%d%H%M%S)-$$-$LOCAL_SHORT"
LOCK_HELD=0
release_lock() { if [ "$LOCK_HELD" = 1 ]; then $SSH bash -s -- release "$LOCK_DIR" "$LOCK_TOKEN" < "$LOCKSH" >/dev/null 2>&1 || true; fi; }
trap release_lock EXIT
if ! $SSH bash -s -- acquire "$LOCK_DIR" "$LOCK_TOKEN" < "$LOCKSH"; then
  echo "❌ 拿不到发布锁 $LOCK_DIR：有别的发布在跑或上次发布中断留下了锁。核实没有发布在跑（docker ps、看锁里的 owner）后再手工 rmdir，脚本不抢锁。"; exit 1
fi
LOCK_HELD=1

# 差量是按确认前读到的父版审的；等确认和排队拿锁期间它可能变了。拿到锁后、任何传码传包之前再读一次，
# 完整提交和两个镜像身份都要一字不差，否则这次核过的范围不再成立。
if [ "$CODE_ONLY" = 1 ]; then
  # 先留住完整输出和退出码，成功才解析：身份行打印完 ssh 才断，这次读取同样不算数。
  LOCKED_RC=0; LOCKED_LINE=$($SSH bash -s -- sealed-parent < "$PREFLIGHT" 2>&1) || LOCKED_RC=$?
  LOCKED_IDENTITY=""
  if [ "$LOCKED_RC" = 0 ]; then LOCKED_IDENTITY=$(grep -m1 '^parent=' <<<"$LOCKED_LINE" || true); fi
  if [ "$LOCKED_RC" != 0 ] || [ "$LOCKED_IDENTITY" != "$PARENT_IDENTITY" ]; then
    echo "❌ 拿到发布锁后封存父版变了或读不到（退出码 $LOCKED_RC），中止；没有传码、没有传包。请重新核父版后再发。"
    echo "    确认时: $PARENT_IDENTITY"; echo "    现在:   ${LOCKED_IDENTITY:-<读不到>}"; exit 1
  fi
fi

# 代码传输和任何服务器写入前，先以本地候选检查远端可用资源。
$SSH bash -s -- resources "$GATE_FREE_GIB" "$GATE_AVAILABLE_MIB" "$MIN_FREE_INODES" "$GATE_LABEL" < "$PREFLIGHT"

if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  BUNDLE="/tmp/ai-platform-$LOCAL_SHORT.bundle"
  echo "==> 打包 ${REMOTE_SHA:0:7}..$LOCAL_SHORT 并传到服务器 ..."
  git bundle create -q "$BUNDLE" "$REMOTE_SHA..main"
  scp -q -o BatchMode=yes "$BUNDLE" "$SSH_HOST:/var/tmp/"
  rm -f "$BUNDLE"
  $SSH "cd $REMOTE_DIR && git fetch -q /var/tmp/ai-platform-$LOCAL_SHORT.bundle main && git merge -q --ff-only FETCH_HEAD && rm -f /var/tmp/ai-platform-$LOCAL_SHORT.bundle && echo \"    服务器现在位于: \$(git rev-parse --short HEAD)\""
fi

# ---------- 2b. 镜像包到服务器：临时名 → 服务器核对摘要 → 改成正式名；已有同摘要的包直接复用（中断后重跑幂等） ----------
REMOTE_PKG_DIR=""
if [ "$MODE" = prebuilt ]; then
  REMOTE_PKG_DIR="/var/tmp/ai-platform-images/$TASK"
  if $SSH "cd '$REMOTE_PKG_DIR' 2>/dev/null && echo '$TAR_SHA256  images.tar.gz' | sha256sum -c --status"; then
    echo "==> 服务器上已有摘要一致的 $REMOTE_PKG_DIR/images.tar.gz，复用，不再传"
  else
    # 纯代码发布不扩大删除范围：任务目录里已有摘要不符的包，说不清是什么，不覆盖。
    if [ "$CODE_ONLY" = 1 ] && $SSH "test -e '$REMOTE_PKG_DIR/images.tar.gz'"; then
      echo "❌ $SSH_HOST:$REMOTE_PKG_DIR 里已有摘要不符的 images.tar.gz，--code-only 不覆盖也不删除，中止。请由人核实后处理。"; exit 1
    fi
    echo "==> 传镜像包（$(( TAR_SIZE / 1048576 )) MiB）到 $SSH_HOST:$REMOTE_PKG_DIR/images.tar.gz.part ..."
    $SSH "mkdir -p '$REMOTE_PKG_DIR' && rm -f '$REMOTE_PKG_DIR/images.tar.gz.part' '$REMOTE_PKG_DIR/images.tar.gz'"
    scp -q -o BatchMode=yes "$PKG_DIR/images.tar.gz" "$SSH_HOST:$REMOTE_PKG_DIR/images.tar.gz.part"
    if ! $SSH "cd '$REMOTE_PKG_DIR' && echo '$TAR_SHA256  images.tar.gz.part' | sha256sum -c --status && mv images.tar.gz.part images.tar.gz"; then
      $SSH "rm -f '$REMOTE_PKG_DIR/images.tar.gz.part'" || true
      echo "❌ 服务器上的包摘要不符（传输中断或损坏），已删除临时文件，没有加载；重跑会重新传。"; exit 1
    fi
    echo "    服务器核对摘要一致"
  fi
  scp -q -o BatchMode=yes "$PKG_DIR/MANIFEST.env" "$SSH_HOST:$REMOTE_PKG_DIR/MANIFEST.env"
fi

# ---------- 3–5. 服务器上构建或加载、备份、迁移、切换、清理 ----------
echo "==> 服务器$([ "$MODE" = prebuilt ] && echo 加载镜像 || echo 构建镜像)并切换 ..."
REMOTE_LOG="$(mktemp)"
$SSH bash -s "$REMOTE_DIR" "$LOCAL_SHORT" "$KEEP_RELEASES" "$GATE_FREE_GIB" "$GATE_AVAILABLE_MIB" "$MIN_FREE_INODES" "$KEEP_DB_BACKUPS" "$MODE" "$LOCK_DIR" "$LOCK_TOKEN" "$REMOTE_PKG_DIR" "$TASK" "$TAR_SHA256" "$BACKEND_IMAGE_ID" "$FRONTEND_IMAGE_ID" "$IMAGE_PLATFORM" "$CODE_ONLY" <<'REMOTE' | tee "$REMOTE_LOG"
set -euo pipefail
REMOTE_DIR="$1"; SHORT="$2"; KEEP="$3"
MIN_FREE_GIB="$4"; MIN_AVAILABLE_MIB="$5"; MIN_FREE_INODES="$6"; KEEP_DB="${7:-7}"
MODE="${8:-build}"; LOCK_DIR="${9:-}"; LOCK_TOKEN="${10:-}"
PKG_DIR="${11:-}"; PKG_TASK="${12:-}"; PKG_SHA="${13:-}"; PKG_BACKEND_ID="${14:-}"; PKG_FRONTEND_ID="${15:-}"; PKG_PLATFORM="${16:-}"
CODE_ONLY="${17:-0}"
cd "$REMOTE_DIR"
# 无论成败，退出时释放发布锁（只释放自己这把）。
if [ -n "$LOCK_DIR" ] && [ -n "$LOCK_TOKEN" ]; then
  trap 'bash dev/docker-release-lock.sh release "$LOCK_DIR" "$LOCK_TOKEN" >/dev/null 2>&1 || true' EXIT
fi
GATE_LABEL=build; [ "$MODE" = prebuilt ] && GATE_LABEL=prebuilt
# 传输/排队期间资源可能变化；创建发布目录前重新检查。
bash dev/docker-release-preflight.sh resources "$MIN_FREE_GIB" "$MIN_AVAILABLE_MIB" "$MIN_FREE_INODES" "$GATE_LABEL"
TS=$(date +%Y%m%d_%H%M%S)
if [ "$MODE" = prebuilt ]; then TAG="$PKG_TASK"; else TAG="v-${SHORT}-${TS}"; fi
REL="/var/backups/ai-platform/releases/ai-platform-${TAG}"
mkdir -p "$REL" /var/backups/ai-platform/mysql
OLD_B=$(docker inspect ai-platform-backend --format '{{.Config.Image}}' 2>/dev/null || echo none)
OLD_F=$(docker inspect ai-platform-frontend --format '{{.Config.Image}}' 2>/dev/null || echo none)
# 回滚标签按镜像 ID 打，而不是按标签名：正在跑的容器的标签可能已被清理掉（2026-09-15 出过 "No such image"）
OLD_B_ID=$(docker inspect ai-platform-backend --format '{{.Image}}' 2>/dev/null || echo none)
OLD_F_ID=$(docker inspect ai-platform-frontend --format '{{.Image}}' 2>/dev/null || echo none)

if [ "$MODE" = prebuilt ]; then
  # 这条路径只加载、只核验；核验不过就删掉刚加载的标签并中止，绝不回退到现场构建。
  [ -n "$PKG_DIR" ] && [ -f "$PKG_DIR/images.tar.gz" ] || { echo "❌ 服务器上没有镜像包 $PKG_DIR/images.tar.gz"; exit 1; }
  echo "    核对镜像包摘要 ..."
  ( cd "$PKG_DIR" && echo "$PKG_SHA  images.tar.gz" | sha256sum -c --status ) || { echo "❌ 服务器上的镜像包摘要不符，不加载"; exit 1; }
  echo "    docker load（日志 $REL/load.log）..."
  if ! docker load -i "$PKG_DIR/images.tar.gz" </dev/null > "$REL/load.log" 2>&1; then
    echo "❌ docker load 失败，最后 20 行："; tail -20 "$REL/load.log"; exit 1
  fi
  HOST_PLATFORM=$(bash dev/docker-release-preflight.sh arch)
  SERVER_DOMAIN=$(grep -E '^CUSTOMER_DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')
  verify_image() { # TAG EXPECTED_ID
    local line id platform domain
    line=$(bash dev/docker-release-preflight.sh image-identity "$1") || { echo "❌ 加载后找不到 $1"; return 1; }
    id=$(echo "$line" | tr ' ' '\n' | grep '^id=' | cut -d= -f2-)
    platform=$(echo "$line" | tr ' ' '\n' | grep '^platform=' | cut -d= -f2-)
    domain=$(echo "$line" | tr ' ' '\n' | grep '^customer_domain=' | cut -d= -f2-)
    [ "$id" = "$2" ] || { echo "❌ 加载出的 $1 ID $id ≠ 清单 $2"; return 1; }
    [ "$platform" = "$PKG_PLATFORM" ] && [ "$platform" = "$HOST_PLATFORM" ] || { echo "❌ $1 平台 $platform ≠ 清单 $PKG_PLATFORM / 服务器 $HOST_PLATFORM"; return 1; }
    case "$1" in
      ai-platform-frontend:*) [ -n "$SERVER_DOMAIN" ] && [ "$domain" = "$SERVER_DOMAIN" ] || { echo "❌ frontend 镜像里的 CUSTOMER_DOMAIN=$domain ≠ 服务器 .env 的 ${SERVER_DOMAIN:-<空>}"; return 1; } ;;
    esac
    echo "    ✓ $1 = $id ($platform)"
  }
  if ! verify_image "ai-platform-backend:$TAG" "$PKG_BACKEND_ID" || ! verify_image "ai-platform-frontend:$TAG" "$PKG_FRONTEND_ID"; then
    docker rmi "ai-platform-backend:$TAG" "ai-platform-frontend:$TAG" >/dev/null 2>&1 || true
    echo "❌ 镜像核验失败：已删除刚加载的两个标签；没有备份、没有迁移、没有切换；这条路径不会在服务器上构建。包保留在 $PKG_DIR 供排查。"; exit 1
  fi
  echo "    镜像核验通过（只表示镜像已在服务器本地，业务尚未切换）"
  if [ "$CODE_ONLY" = 1 ]; then
    # 下面要替换的 CMD 必须就是这一份，否则"只留后半段"不成立；镜像改过启动方式就不是纯代码发布。
    IMAGE_CMD=$(docker image inspect "ai-platform-backend:$TAG" --format '{{json .Config.Cmd}}' 2>/dev/null || true)
    if [ "$IMAGE_CMD" != '["/bin/sh","-c","/usr/local/bin/run-migrations.sh && su-exec nodejs node src/server.js"]' ]; then
      docker rmi "ai-platform-backend:$TAG" "ai-platform-frontend:$TAG" >/dev/null 2>&1 || true
      echo "❌ 目标镜像的 CMD 不是预期（${IMAGE_CMD:-<读不到>}），--code-only 不适用：已删除刚加载的两个标签；没有备份、没有切换。"; exit 1
    fi
  fi
else
  echo "    docker compose build backend（日志 $REL/build.log）..."
  if ! docker compose build backend </dev/null > "$REL/build.log" 2>&1; then
    echo "❌ 后端镜像构建失败，最后 40 行："; tail -40 "$REL/build.log"; exit 1
  fi
  # backend 构建会消耗磁盘/inode；再核一次才允许构建 frontend。
  bash dev/docker-release-preflight.sh resources "$MIN_FREE_GIB" "$MIN_AVAILABLE_MIB" "$MIN_FREE_INODES"
  echo "    docker compose build frontend（日志 $REL/build.log）..."
  if ! docker compose build frontend </dev/null >> "$REL/build.log" 2>&1; then
    echo "❌ 镜像构建失败，最后 40 行："; tail -40 "$REL/build.log"; exit 1
  fi
  docker tag ai-platform-backend:latest  "ai-platform-backend:${TAG}"
  docker tag ai-platform-frontend:latest "ai-platform-frontend:${TAG}"
fi
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
# 纯代码发布：镜像 CMD 是 "run-migrations.sh && su-exec nodejs node src/server.js"，这里只留后半段，容器启动就不连库跑 SQL 迁移脚本。
# 只写在这两个发布文件里、镜像字节不变；下一次常规发布的 override 没有这一行，自然回到镜像自己的 CMD。
CODE_ONLY_COMMAND='["su-exec", "nodejs", "node", "src/server.js"]'
if [ "$CODE_ONLY" = 1 ]; then
  for f in "$REL/release.override.yml" "$REL/rollback.override.yml"; do
    if [ -f "$f" ]; then sed -i "/^    image: ai-platform-backend:/a\\    command: $CODE_ONLY_COMMAND" "$f"; fi
  done
fi
{
  echo "TASK_ID=deploy-docker"
  echo "RELEASE_TIME=$TS"
  echo "SOURCE_COMMIT=$(git rev-parse HEAD)"
  echo "PREVIOUS_BACKEND_TAG=$OLD_B"
  echo "PREVIOUS_FRONTEND_TAG=$OLD_F"
  echo "CANDIDATE_TAG=$TAG"
  echo "ROLLBACK_TAG=rollback-$TS"
  if [ "$CODE_ONLY" = 1 ]; then echo "RELEASE_KIND=code-only"; fi
  if [ "$MODE" = prebuilt ]; then
    echo "IMAGES_SOURCE=prebuilt"
    echo "IMAGE_PACKAGE=$PKG_DIR/images.tar.gz"
    echo "IMAGE_PACKAGE_SHA256=$PKG_SHA"
    echo "BACKEND_IMAGE_ID=$PKG_BACKEND_ID"
    echo "FRONTEND_IMAGE_ID=$PKG_FRONTEND_ID"
    echo "IMAGE_PLATFORM=$PKG_PLATFORM"
    echo "IMAGES_LOADED=1"
  else
    echo "IMAGES_BUILT=backend,frontend"
  fi
} > "$REL/RELEASE.txt"
[ "$MODE" = prebuilt ] && [ -f "$PKG_DIR/MANIFEST.env" ] && cp "$PKG_DIR/MANIFEST.env" "$REL/IMAGE-MANIFEST.env"
ln -sfn "$REL" /var/backups/ai-platform/releases/current

echo "    备份数据库 ..."
BK="/var/backups/ai-platform/mysql/ai_platform-${TS}.sql.gz"
docker exec ai-platform-mysql sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --quick "$MYSQL_DATABASE" 2>/dev/null' | gzip > "$BK"
[ -s "$BK" ] || { echo "❌ 备份为空，中止"; exit 1; }
echo "    备份: $BK ($(du -h "$BK" | cut -f1))"; echo "DB_BACKUP=$BK" >> "$REL/RELEASE.txt"

if [ "$CODE_ONLY" = 1 ]; then
  echo "    纯代码发布：不执行 knex 迁移"
  echo "DB_MIGRATED=skipped-code-only" >> "$REL/RELEASE.txt"
else
  echo "    用新镜像执行 knex 迁移（切换前）..."
  # 注意：本段脚本经 stdin 喂给远端 bash -s，任何会读 stdin 的命令都必须 </dev/null，否则会把脚本剩余部分吃掉
  docker compose -f docker-compose.yml -f "$REL/release.override.yml" run --rm --no-deps -T backend npx knex migrate:latest </dev/null 2>&1 | grep -vE '^$|Using environment|attribute .version. is obsolete' | sed 's/^/      /' || { echo "❌ 迁移失败，容器未切换；库已备份到 $BK"; exit 1; }
  echo "DB_MIGRATED=1" >> "$REL/RELEASE.txt"
fi

echo "    切换容器 ..."
docker compose -f docker-compose.yml -f "$REL/release.override.yml" up -d backend frontend </dev/null >/dev/null 2>&1
echo "CONTAINERS_SWITCHED=1" >> "$REL/RELEASE.txt"
RUNTIME_STATUS=starting
for i in $(seq 1 36); do
  RUNTIME_STATUS=$(bash dev/docker-release-preflight.sh runtime "$SHORT")
  [ "$RUNTIME_STATUS" = CURRENT ] && break; sleep 5
done
if [ "$RUNTIME_STATUS" != CURRENT ]; then
  echo "❌ 双容器 3 分钟内未运行本次镜像且 healthy（$RUNTIME_STATUS）。回滚命令："
  echo "   docker compose -f $REMOTE_DIR/docker-compose.yml -f $REL/rollback.override.yml up -d backend frontend"
  docker logs --tail 40 ai-platform-backend 2>&1 | cut -c1-160; exit 1
fi
L=$(docker logs ai-platform-backend 2>&1 || true)
if [ "$CODE_ONLY" = 1 ]; then
  # 切换后再核一次：新容器的 CMD 确实被替换，且日志里没有启动脚本的第一行；不符就不算发布成功。
  ACTUAL_CMD=$(docker inspect ai-platform-backend --format '{{json .Config.Cmd}}' 2>/dev/null || true)
  if [ "$ACTUAL_CMD" != '["su-exec","nodejs","node","src/server.js"]' ] || grep -q '检查数据库迁移' <<<"$L"; then
    echo "❌ 纯代码发布的后端不符合预期（CMD=${ACTUAL_CMD:-<读不到>}，或日志显示启动迁移脚本运行过）。回滚命令："
    echo "   docker compose -f $REMOTE_DIR/docker-compose.yml -f $REL/rollback.override.yml up -d backend frontend"
    exit 1
  fi
  echo "    启动脚本 SQL 迁移：未运行（CMD=$ACTUAL_CMD）"
  echo "STARTUP_MIGRATIONS=skipped-code-only" >> "$REL/RELEASE.txt"
else
  echo "    启动脚本 SQL 迁移：执行 $(echo "$L" | grep -c '^执行迁移' || true) 跳过 $(echo "$L" | grep -c '跳过已执行' || true) 失败 $(echo "$L" | grep -c '执行失败' || true)"
fi
docker ps --format '    {{.Names}}  {{.Image}}  {{.Status}}' | grep ai-platform
echo "REMOTE_HEALTHY=1" >> "$REL/RELEASE.txt"
echo "FINAL_STATUS=RELEASED" >> "$REL/RELEASE.txt"

if [ "$CODE_ONLY" = 1 ]; then
  # 只跳过清理，不改保留份数：下一次常规发布照常按 KEEP/KEEP_DB 收回。
  echo "    纯代码发布：不清理旧镜像、不清理旧库备份"
  echo "RETENTION_CLEANUP=skipped-code-only" >> "$REL/RELEASE.txt"
else
  echo "    清理旧镜像（每个仓库保留最近 $KEEP 个发布及其 rollback；正在运行的镜像永远不删）..."
  # 标签形如 v-<sha>-<YYYYmmdd_HHMMSS> / rollback-<YYYYmmdd_HHMMSS>：按末尾 15 位完整时间戳倒序才是按时间。
  # 以前按 "_" 后的时分秒排序，把当天凌晨发布的当成最旧删掉了，连正在跑的容器的标签都被清掉
  RUN_IDS="$(docker inspect ai-platform-backend ai-platform-frontend --format '{{.Image}}' 2>/dev/null || true)"
  for repo in ai-platform-backend ai-platform-frontend; do
    for pat in '^v-' '^rollback-'; do
      # 某个仓库还没有任何 v-/rollback- 标签时 grep 返回 1，pipefail 会让整段在切换成功之后才中止；清理阶段找不到可删的不算失败。
      docker images --format '{{.Tag}}' "$repo" | { grep -E "$pat" || true; } | awk '{ print substr($0, length($0) - 14) "\t" $0 }' | sort -r | cut -f2 | tail -n +$((KEEP + 1)) | while read -r t; do
        id=$(docker image inspect "$repo:$t" --format '{{.Id}}' 2>/dev/null || true)
        [ -n "$id" ] && echo "$RUN_IDS" | grep -q "$id" && continue
        docker rmi "$repo:$t" >/dev/null 2>&1 || true
      done
    done
  done
  echo "    清理旧库备份（只保留最近 $KEEP_DB 份；本次发布前的备份最新，一定保留）..."
  # 只在切换成功后执行，失败的发布不删任何备份。名字形如 ai_platform-<YYYYmmdd_HHMMSS>.sql.gz（本脚本与
  # make migrate-docker 都这样命名），按名字倒序就是按时间倒序；不符合这个形式的文件一律不碰。
  # 2026-10-03 北大就是因为备份攒到 22 份（6.7G）把磁盘挤到资源门以下，前端构建前被拦停。
  if [[ "$KEEP_DB" =~ ^[1-9][0-9]*$ ]]; then
    mapfile -t BACKUPS < <(ls -1 /var/backups/ai-platform/mysql/ 2>/dev/null | grep -E '^ai_platform-[0-9]{8}_[0-9]{6}\.sql\.gz$' | sort -r || true)
    for f in "${BACKUPS[@]:$KEEP_DB}"; do
      rm -f -- "/var/backups/ai-platform/mysql/$f" 2>/dev/null && echo "      删除 $f" || echo "      ⚠ 无法删除 $f"
    done
  else
    echo "    ⚠ 备份保留份数无效（$KEEP_DB），本次不清理旧备份"
  fi
fi
if [ "$MODE" = prebuilt ] && [ -n "$PKG_DIR" ]; then
  if [ "$CODE_ONLY" = 1 ]; then
    # 只删本次核过的两个文件：包摘要等于本次发布的包（本机留有同摘要副本），清单与发布目录里的副本相同。
    # 目录里别的东西不是本次的，一律不碰；目录空了才去掉。摘要变了就全部留下。
    if ( cd "$PKG_DIR" && echo "$PKG_SHA  images.tar.gz" | sha256sum -c --status ) && cmp -s "$PKG_DIR/MANIFEST.env" "$REL/IMAGE-MANIFEST.env"; then
      rm -f -- "$PKG_DIR/images.tar.gz" "$PKG_DIR/MANIFEST.env"
      if rmdir -- "$PKG_DIR" 2>/dev/null; then echo "    已删除本次上传的镜像包 $PKG_DIR（清单已留在发布目录）"; else echo "    已删除本次上传的两个文件；$PKG_DIR 里还有别的文件，保留"; fi
      echo "STAGED_PACKAGE=removed-own-files" >> "$REL/RELEASE.txt"
    else
      echo "    ⚠ $PKG_DIR 里的包或清单与本次核过的不一致，全部保留，请由人核实"
      echo "STAGED_PACKAGE=retained-not-verified" >> "$REL/RELEASE.txt"
    fi
  else
    rm -rf -- "$PKG_DIR" && echo "    已删除服务器上的镜像包 $PKG_DIR（清单已留在发布目录）"
  fi
fi
echo "    磁盘: $(df -h / | tail -1 | awk '{print $5" 已用，剩 "$4}')"
echo "    发布目录: $REL"
echo "REMOTE_DONE"
REMOTE

grep -q '^REMOTE_DONE$' "$REMOTE_LOG" || { echo "❌ 服务器端脚本没有执行到底（容器可能没有切换），请看上面的输出与 make status-docker"; rm -f "$REMOTE_LOG"; exit 1; }
rm -f "$REMOTE_LOG"
RUNTIME_POST=$($SSH bash -s -- runtime "$LOCAL_SHORT" < "$PREFLIGHT")
if [ "$RUNTIME_POST" != CURRENT ]; then
  echo "❌ 服务器双容器未运行本次镜像或健康异常：$RUNTIME_POST；请看 make status-docker"; exit 1
fi

# ---------- 6. 本地标签与线上健康检查 ----------
echo ""
echo "   线上健康检查:"; curl -sf -m 15 "$HEALTH_URL" && echo || { echo "❌ 健康检查失败"; exit 1; }
for u in /api/ai-lab/tasks /login; do printf "   %-22s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$SITE_ORIGIN$u")"; done
TAG="deploy-docker-$(date +%Y%m%d_%H%M%S)"
git tag -a "$TAG" -m "deploy $LOCAL_SHORT to $SSH_HOST (docker$([ "$MODE" = prebuilt ] && echo ", prebuilt $TASK"))"
git push -q origin "$TAG" 2>/dev/null || echo "⚠ tag 推送失败（本地已打 $TAG）"
echo "✅ Docker 发布完成，已打标签 $TAG"
