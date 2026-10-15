#!/usr/bin/env bash
# 为 Docker 站点（ai.pkuailab.com）在"构建主机"（默认 ssh practice，即 ai.xingyuncl.com 所在机器）构建 backend/frontend 镜像，
# 打包取回本机，供 make deploy-docker ARGS=--prebuilt=<包目录> 只加载不构建地发布。路径：
#   1. 本地检查：工作区干净、在 main、HEAD 已推 GitHub（与 deploy-docker 同一口径）
#   2. 目标平台：从 Docker 站点只读探测（或 --target-arch 显式给出）；构建主机平台不同即拒绝，首期不做跨架构构建
#   3. 构建主机只读前检：docker 可用与平台、磁盘/内存/inode、基础镜像是否已在本地（缺则构建时要能访问镜像仓库）
#   4. git archive HEAD → 构建主机专属任务目录（不碰 /var/www/ai-platform 的 PM2 业务目录），资源门后依次 docker build
#      backend/frontend，标签 ai-platform-{backend,frontend}:v-<短sha>-<时间戳>（与 deploy-docker 的发布标签同形）；
#      旧构建器（DOCKER_BUILDKIT=0）下带 --memory/--memory-swap/--cpu-shares 上限，不让构建把构建主机的既有服务挤出内存
#   5. docker save | gzip → images.tar.gz，连同 MANIFEST（源码提交与树、Dockerfile/依赖锁/compose 摘要、构建参数、
#      基础镜像身份、平台、两镜像 ID 与大小、tar 摘要）取回 $IMAGE_PACKAGE_ROOT/<任务>/，本机核对摘要
#   6. 取回核对成功后删除构建主机上的任务目录与两个任务标签（不 prune、不碰其他镜像；--keep-remote 保留）
# 用法: make build-images                        （前检 → 确认 → 构建 → 打包 → 取回）
#       make build-images ARGS=--precheck        （只做只读前检，不建目录、不构建、不写服务器）
#       make build-images ARGS=-y                （跳过确认，仅用于自动化）
#       make build-images ARGS=--keep-remote     （保留构建主机上的任务目录与标签）
#       make build-images ARGS=--target-arch=linux/amd64（不探测 Docker 站点，显式给目标平台；须与 make status-docker 所见一致）
# 环境变量: IMAGE_BUILD_SSH_HOST=practice  IMAGE_BUILD_DIR=/var/tmp/ai-platform-image-build  DOCKER_SSH_HOST=pkuailab
#           DOCKER_HEALTH_URL=https://ai.pkuailab.com/health（其主机名就是 frontend 镜像的 CUSTOMER_DOMAIN 构建参数；IMAGE_CUSTOMER_DOMAIN 可覆盖）
#           IMAGE_PACKAGE_ROOT=$HOME/ai-platform-images（包目录放在仓库之外，deploy-docker 的"工作区干净"检查不受影响）
#           IMAGE_BUILD_MIN_FREE_GIB=8  IMAGE_BUILD_MIN_AVAILABLE_MIB=4864  IMAGE_BUILD_MIN_FREE_INODES=100000
#             （4864 = 2026-10-14 本机实测前端构建 cgroup 峰值 3789 MiB + 1024 MiB 预留，总控登记值；按构建主机实际容量评估后再调）
#           IMAGE_BUILD_BUILDER=legacy|buildkit（默认 legacy：只有旧构建器接受 --memory/--cpu-shares；buildkit 没有逐次构建的内存上限，只靠资源门）
#           IMAGE_BUILD_MEMORY_CAP_MIB=4608  IMAGE_BUILD_CPU_SHARES=256
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_HOST="${IMAGE_BUILD_SSH_HOST:-practice}"
BUILD_DIR="${IMAGE_BUILD_DIR:-/var/tmp/ai-platform-image-build}"
TARGET_HOST="${DOCKER_SSH_HOST:-pkuailab}"
HEALTH_URL="${DOCKER_HEALTH_URL:-https://ai.pkuailab.com/health}"
SITE_HOST="${HEALTH_URL#https://}"; SITE_HOST="${SITE_HOST#http://}"; SITE_HOST="${SITE_HOST%%/*}"
CUSTOMER_DOMAIN="${IMAGE_CUSTOMER_DOMAIN:-$SITE_HOST}"
PACKAGE_ROOT="${IMAGE_PACKAGE_ROOT:-$HOME/ai-platform-images}"
MIN_FREE_GIB="${IMAGE_BUILD_MIN_FREE_GIB:-8}"
MIN_AVAILABLE_MIB="${IMAGE_BUILD_MIN_AVAILABLE_MIB:-4864}"
MIN_FREE_INODES="${IMAGE_BUILD_MIN_FREE_INODES:-100000}"
BUILDER="${IMAGE_BUILD_BUILDER:-legacy}"
MEMORY_CAP_MIB="${IMAGE_BUILD_MEMORY_CAP_MIB:-4608}"
CPU_SHARES="${IMAGE_BUILD_CPU_SHARES:-256}"
PRECHECK=0; ASSUME_YES=0; KEEP_REMOTE=0; TARGET_PLATFORM=""
for a in "$@"; do
  case "$a" in
    --precheck) PRECHECK=1 ;;
    -y) ASSUME_YES=1 ;;
    --keep-remote) KEEP_REMOTE=1 ;;
    --target-arch=*) TARGET_PLATFORM="${a#--target-arch=}" ;;
    *) echo "未知参数: $a"; exit 1 ;;
  esac
done
case "$BUILDER" in legacy|buildkit) ;; *) echo "❌ IMAGE_BUILD_BUILDER 只能是 legacy 或 buildkit（当前: $BUILDER）"; exit 1 ;; esac
for v in "$MIN_FREE_GIB" "$MIN_AVAILABLE_MIB" "$MIN_FREE_INODES" "$MEMORY_CAP_MIB" "$CPU_SHARES"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "❌ 资源参数必须是非负整数（当前: $v）"; exit 1; }
done
[[ "$CUSTOMER_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "❌ CUSTOMER_DOMAIN 不合法: $CUSTOMER_DOMAIN"; exit 1; }
[[ "$BUILD_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "❌ IMAGE_BUILD_DIR 必须是绝对路径且只含常规字符: $BUILD_DIR"; exit 1; }
SSH_B="ssh -o BatchMode=yes -o ConnectTimeout=20 $BUILD_HOST"
SSH_T="ssh -o BatchMode=yes -o ConnectTimeout=20 $TARGET_HOST"
PREFLIGHT="$ROOT/dev/docker-release-preflight.sh"
cd "$ROOT"

# ---------- 1. 本地检查 ----------
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 本地有未提交改动，请先提交："; git status --short; exit 1
fi
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = main ] || { echo "❌ 请在 main 上构建发布镜像（当前 $BRANCH）"; exit 1; }
git fetch -q origin
LOCAL_SHA=$(git rev-parse HEAD)
LOCAL_SHORT=$(git rev-parse --short HEAD)
if ! git merge-base --is-ancestor "$LOCAL_SHA" origin/main; then
  echo "❌ HEAD 尚未推送到 GitHub main，请先 git push origin main（GitHub 是代码真相）"; exit 1
fi

# ---------- 2. 目标平台 ----------
if [ -z "$TARGET_PLATFORM" ]; then
  TARGET_PLATFORM=$($SSH_T bash -s -- arch < "$PREFLIGHT" 2>/dev/null || echo unknown)
fi
if ! [[ "$TARGET_PLATFORM" =~ ^linux/(amd64|arm64)$ ]]; then
  echo "❌ Docker 站点平台未知或不支持（$TARGET_PLATFORM）：架构未知不构建。可用 ARGS=--target-arch=linux/amd64 显式给出，但必须与 Docker 站点实际一致。"; exit 1
fi

# ---------- 3. 构建主机只读前检 ----------
PRE=$($SSH_B bash -s -- "$BUILD_DIR" <<'PRECHECK'
set -u
BUILD_DIR="$1"
if ! command -v docker >/dev/null 2>&1; then echo "docker=missing"; exit 0; fi
if ! docker version >/dev/null 2>&1; then echo "docker=unreachable"; exit 0; fi
echo "docker=ok"
echo "docker_server=$(docker version --format '{{.Server.Version}}')"
echo "platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
echo "uname_m=$(uname -m)"
echo "kernel=$(uname -r)"
echo "buildx=$(docker buildx version >/dev/null 2>&1 && echo present || echo absent)"
echo "storage_driver=$(docker info --format '{{.Driver}}' 2>/dev/null)"
DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /)
echo "docker_root=$DOCKER_ROOT"
echo "ncpu=$(nproc)"
echo "mem_total_bytes=$(free -b | awk '$1=="Mem:" {print $2}')"
echo "mem_available_bytes=$(free -b | awk '$1=="Mem:" {print $7}')"
echo "swap_total_bytes=$(free -b | awk '$1=="Swap:" {print $2}')"
echo "disk_root_avail_bytes=$(df -B1 --output=avail / | awk 'NR==2 {print $1}')"
echo "disk_docker_root_avail_bytes=$(df -B1 --output=avail "$DOCKER_ROOT" 2>/dev/null | awk 'NR==2 {print $1}')"
echo "disk_build_dir_avail_bytes=$(df -B1 --output=avail "$(dirname "$BUILD_DIR")" 2>/dev/null | awk 'NR==2 {print $1}')"
echo "inodes_root_avail=$(df --output=iavail / | awk 'NR==2 {print $1}')"
for img in node:18-alpine nginx:alpine; do
  key="base_${img%%:*}"
  if docker image inspect "$img" >/dev/null 2>&1; then echo "$key=present $(docker image inspect "$img" --format '{{.Id}}')"; else echo "$key=absent"; fi
done
echo "build_dir_exists=$([ -d "$BUILD_DIR" ] && echo yes || echo no)"
echo "task_dirs_present=$(ls -1 "$BUILD_DIR" 2>/dev/null | wc -l)"
PRECHECK
) || { echo "❌ 连不上构建主机 $BUILD_HOST 或前检脚本失败"; exit 1; }
pre() { echo "$PRE" | grep -E "^$1=" | head -1 | cut -d= -f2-; }
case "$(pre docker)" in
  ok) ;;
  missing) echo "❌ 构建主机 $BUILD_HOST 没有 docker 命令。是否安装 Docker 由你决定，本脚本不安装、不改构建主机。"; exit 1 ;;
  *) echo "❌ 构建主机 $BUILD_HOST 的 Docker 守护进程不可用（当前用户无权限或未运行）。本脚本不改构建主机。"; exit 1 ;;
esac
BUILD_PLATFORM_RAW="$(pre platform)"
case "${BUILD_PLATFORM_RAW#*/}" in x86_64|amd64) BUILD_PLATFORM="${BUILD_PLATFORM_RAW%/*}/amd64" ;; aarch64|arm64) BUILD_PLATFORM="${BUILD_PLATFORM_RAW%/*}/arm64" ;; *) BUILD_PLATFORM="$BUILD_PLATFORM_RAW" ;; esac
if [ "$BUILD_PLATFORM" != "$TARGET_PLATFORM" ]; then
  echo "❌ 构建主机平台 $BUILD_PLATFORM 与 Docker 站点平台 $TARGET_PLATFORM 不同：首期不做跨架构构建，中止。"; exit 1
fi
mkdir -p "$PACKAGE_ROOT"
PRECHECK_FILE="$PACKAGE_ROOT/precheck-${BUILD_HOST}-$(date +%Y%m%d_%H%M%S).env"
{ echo "$PRE"; echo "target_platform=$TARGET_PLATFORM"; echo "target_host=$TARGET_HOST"; echo "source_commit=$LOCAL_SHA"; echo "checked_at=$(date -u +%FT%TZ)"; } > "$PRECHECK_FILE"
mem_avail_mib=$(( $(pre mem_available_bytes) / 1048576 ))
disk_avail_gib=$(( $(pre disk_root_avail_bytes) / 1073741824 ))
echo ""
echo "================ 镜像构建前检（构建主机 $BUILD_HOST → Docker 站点 $TARGET_HOST）================"
echo "  源码提交:      $LOCAL_SHORT（HEAD = GitHub main）"
echo "  目标平台:      $TARGET_PLATFORM；构建主机平台 $BUILD_PLATFORM（Docker $(pre docker_server)，$(pre storage_driver)，buildx $(pre buildx)）"
echo "  构建主机资源:  CPU $(pre ncpu)，内存可用 ${mem_avail_mib} MiB / 总 $(( $(pre mem_total_bytes) / 1048576 )) MiB，swap $(( $(pre swap_total_bytes) / 1048576 )) MiB，根盘可用 ${disk_avail_gib} GiB，inode $(pre inodes_root_avail)"
echo "  资源门:        ≥ ${MIN_FREE_GIB} GiB 磁盘、≥ ${MIN_AVAILABLE_MIB} MiB 可用内存、≥ ${MIN_FREE_INODES} inode（构建前与两次构建之间各核一次）"
echo "  构建器/上限:   $BUILDER$([ "$BUILDER" = legacy ] && echo "（每步 --memory=${MEMORY_CAP_MIB}m --memory-swap=${MEMORY_CAP_MIB}m --cpu-shares=${CPU_SHARES}）" || echo "（BuildKit 无逐次构建内存上限，只靠资源门）")"
echo "  基础镜像:      node:18-alpine $(pre base_node)；nginx:alpine $(pre base_nginx)$( [ "$(pre base_node)" = absent ] || [ "$(pre base_nginx)" = absent ] && echo "（absent 表示构建时要从镜像仓库拉取，构建主机能否访问仓库未知）")"
echo "  CUSTOMER_DOMAIN 构建参数: $CUSTOMER_DOMAIN（只用于 frontend 镜像的 nginx 模板默认值；运行配置与凭据只在 Docker 站点注入）"
echo "  任务目录:      $BUILD_DIR/v-${LOCAL_SHORT}-<时间戳>（已有 $(pre task_dirs_present) 个任务目录）；包取回到 $PACKAGE_ROOT/"
echo "  前检记录:      $PRECHECK_FILE"
echo "=============================================================================================="
if (( mem_avail_mib < MIN_AVAILABLE_MIB )) || (( disk_avail_gib < MIN_FREE_GIB )); then
  echo "⚠ 构建主机当前资源低于资源门，构建会在门口被拒；不要为了过门去降门，先弄清构建主机的容量。"
fi
if [ "$PRECHECK" = 1 ]; then echo "✅ 只读前检完成，没有在任何服务器上写入。"; exit 0; fi
if [ "$ASSUME_YES" != 1 ]; then
  read -rp "确认在 $BUILD_HOST 上为 $TARGET_HOST 构建 $LOCAL_SHORT 的镜像并取回? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "已取消"; exit 1; }
fi

# ---------- 4. 构建主机：资源门 → 源码 → 构建 → 打包 ----------
$SSH_B bash -s -- resources "$MIN_FREE_GIB" "$MIN_AVAILABLE_MIB" "$MIN_FREE_INODES" image-build < "$PREFLIGHT"
TS=$(date +%Y%m%d_%H%M%S)
TASK="v-${LOCAL_SHORT}-${TS}"
TASK_DIR="$BUILD_DIR/$TASK"
$SSH_B "mkdir -p '$TASK_DIR/src' && [ -z \"\$(ls -A '$TASK_DIR/src')\" ]" || { echo "❌ 构建主机上任务目录已存在且非空: $TASK_DIR"; exit 1; }
echo "==> 传源码 $LOCAL_SHORT（git archive，只含已提交文件）到 $BUILD_HOST:$TASK_DIR/src ..."
git archive --format=tar HEAD | $SSH_B "tar -x -C '$TASK_DIR/src'"
echo "==> 构建主机构建并打包（日志在 $TASK_DIR/）..."
REMOTE_LOG="$(mktemp)"
$SSH_B bash -s "$TASK_DIR" "$TASK" "$BUILDER" "$MEMORY_CAP_MIB" "$CPU_SHARES" "$CUSTOMER_DOMAIN" "$MIN_FREE_GIB" "$MIN_AVAILABLE_MIB" "$MIN_FREE_INODES" <<'REMOTE' | tee "$REMOTE_LOG"
set -euo pipefail
TASK_DIR="$1"; TASK="$2"; BUILDER="$3"; CAP="$4"; SHARES="$5"; DOMAIN="$6"; MIN_GIB="$7"; MIN_MIB="$8"; MIN_INODES="$9"
cd "$TASK_DIR/src"
BUILD_OPTS=()
if [ "$BUILDER" = legacy ]; then
  export DOCKER_BUILDKIT=0
  BUILD_OPTS+=(--memory="${CAP}m" --memory-swap="${CAP}m" --cpu-shares="$SHARES")
else
  export DOCKER_BUILDKIT=1
fi
# 任何读 stdin 的命令都要 </dev/null：本段脚本经 stdin 喂给远端 bash -s
echo "    docker build backend → ai-platform-backend:$TASK（日志 $TASK_DIR/build-backend.log）..."
if ! docker build "${BUILD_OPTS[@]}" -f docker/Dockerfile.backend -t "ai-platform-backend:$TASK" . </dev/null > "$TASK_DIR/build-backend.log" 2>&1; then
  echo "❌ 后端镜像构建失败，最后 40 行："; tail -40 "$TASK_DIR/build-backend.log"; exit 1
fi
bash dev/docker-release-preflight.sh resources "$MIN_GIB" "$MIN_MIB" "$MIN_INODES" image-build
echo "    docker build frontend → ai-platform-frontend:$TASK（--build-arg CUSTOMER_DOMAIN=$DOMAIN，日志 $TASK_DIR/build-frontend.log）..."
if ! docker build "${BUILD_OPTS[@]}" --build-arg "CUSTOMER_DOMAIN=$DOMAIN" -f docker/Dockerfile.frontend -t "ai-platform-frontend:$TASK" . </dev/null > "$TASK_DIR/build-frontend.log" 2>&1; then
  echo "❌ 前端镜像构建失败，最后 40 行："; tail -40 "$TASK_DIR/build-frontend.log"; exit 1
fi
B=$(bash dev/docker-release-preflight.sh image-identity "ai-platform-backend:$TASK")
F=$(bash dev/docker-release-preflight.sh image-identity "ai-platform-frontend:$TASK")
field() { echo "$1" | tr ' ' '\n' | grep -E "^$2=" | head -1 | cut -d= -f2-; }
B_PLATFORM=$(field "$B" platform); F_PLATFORM=$(field "$F" platform)
[ "$B_PLATFORM" = "$F_PLATFORM" ] || { echo "❌ 两镜像平台不一致：backend $B_PLATFORM，frontend $F_PLATFORM"; exit 1; }
[ "$(field "$F" customer_domain)" = "$DOMAIN" ] || { echo "❌ frontend 镜像里的 CUSTOMER_DOMAIN=$(field "$F" customer_domain) 不是 $DOMAIN"; exit 1; }
echo "    docker save → $TASK_DIR/images.tar.gz ..."
docker save "ai-platform-backend:$TASK" "ai-platform-frontend:$TASK" </dev/null | gzip -1 > "$TASK_DIR/images.tar.gz"
TAR_SHA=$(sha256sum "$TASK_DIR/images.tar.gz" | cut -d' ' -f1)
TAR_SIZE=$(stat -c %s "$TASK_DIR/images.tar.gz")
{
  echo "TASK=$TASK"
  echo "BUILDER=$BUILDER"
  echo "BUILD_MEMORY_CAP_MIB=$([ "$BUILDER" = legacy ] && echo "$CAP" || echo none)"
  echo "BUILD_CPU_SHARES=$([ "$BUILDER" = legacy ] && echo "$SHARES" || echo none)"
  echo "BUILD_HOST_PLATFORM=$(bash dev/docker-release-preflight.sh arch)"
  echo "BUILD_HOST_DOCKER=$(docker version --format '{{.Server.Version}}')"
  echo "BUILD_HOST_KERNEL=$(uname -r)"
  echo "CUSTOMER_DOMAIN_BUILD_ARG=$DOMAIN"
  echo "BACKEND_IMAGE_TAG=ai-platform-backend:$TASK"
  echo "BACKEND_IMAGE_ID=$(field "$B" id)"
  echo "BACKEND_IMAGE_SIZE=$(field "$B" size)"
  echo "FRONTEND_IMAGE_TAG=ai-platform-frontend:$TASK"
  echo "FRONTEND_IMAGE_ID=$(field "$F" id)"
  echo "FRONTEND_IMAGE_SIZE=$(field "$F" size)"
  echo "FRONTEND_IMAGE_CUSTOMER_DOMAIN=$(field "$F" customer_domain)"
  echo "IMAGE_PLATFORM=$B_PLATFORM"
  echo "BASE_NODE_IMAGE_ID=$(docker image inspect node:18-alpine --format '{{.Id}}')"
  echo "BASE_NODE_REPO_DIGESTS=$(docker image inspect node:18-alpine --format '{{join .RepoDigests ","}}')"
  echo "BASE_NGINX_IMAGE_ID=$(docker image inspect nginx:alpine --format '{{.Id}}')"
  echo "BASE_NGINX_REPO_DIGESTS=$(docker image inspect nginx:alpine --format '{{join .RepoDigests ","}}')"
  echo "TAR_SHA256=$TAR_SHA"
  echo "TAR_SIZE=$TAR_SIZE"
  echo "BUILT_AT=$(date -u +%FT%TZ)"
} > "$TASK_DIR/MANIFEST.remote.env"
echo "    镜像: backend $(field "$B" id | cut -c1-19)… ($(( $(field "$B" size) / 1048576 )) MiB)  frontend $(field "$F" id | cut -c1-19)… ($(( $(field "$F" size) / 1048576 )) MiB)  平台 $B_PLATFORM"
echo "    包:   images.tar.gz $(( TAR_SIZE / 1048576 )) MiB  sha256 $TAR_SHA"
echo "REMOTE_BUILD_DONE"
REMOTE
grep -q '^REMOTE_BUILD_DONE$' "$REMOTE_LOG" || { echo "❌ 构建主机脚本没有执行到底，任务目录 $TASK_DIR 保留供排查（不会自动删除）"; rm -f "$REMOTE_LOG"; exit 1; }
rm -f "$REMOTE_LOG"

# ---------- 5. 取回并核对 ----------
PKG="$PACKAGE_ROOT/$TASK"
mkdir -p "$PKG"
scp -q -o BatchMode=yes "$BUILD_HOST:$TASK_DIR/MANIFEST.remote.env" "$PKG/MANIFEST.remote.env"
man() { grep -E "^$1=" "$PKG/MANIFEST.remote.env" | head -1 | cut -d= -f2-; }
TAR_SHA="$(man TAR_SHA256)"; TAR_SIZE="$(man TAR_SIZE)"
[[ "$TAR_SHA" =~ ^[0-9a-f]{64}$ ]] && [[ "$TAR_SIZE" =~ ^[0-9]+$ ]] || { echo "❌ 构建主机清单不完整（TAR_SHA256/TAR_SIZE）"; exit 1; }
[ "$(man IMAGE_PLATFORM)" = "$TARGET_PLATFORM" ] || { echo "❌ 构建出的镜像平台 $(man IMAGE_PLATFORM) 不是目标 $TARGET_PLATFORM，任务目录保留"; exit 1; }
echo "==> 取回 images.tar.gz（$(( TAR_SIZE / 1048576 )) MiB）到 $PKG/ ..."
T0=$(date +%s)
scp -q -o BatchMode=yes "$BUILD_HOST:$TASK_DIR/images.tar.gz" "$PKG/images.tar.gz.part"
T1=$(date +%s)
LOCAL_SHA256=$(sha256sum "$PKG/images.tar.gz.part" | cut -d' ' -f1)
if [ "$LOCAL_SHA256" != "$TAR_SHA" ]; then
  rm -f "$PKG/images.tar.gz.part"; echo "❌ 取回的包摘要不符（本机 $LOCAL_SHA256 ≠ 清单 $TAR_SHA），已删除；构建主机任务目录保留，可重跑取回"; exit 1
fi
mv "$PKG/images.tar.gz.part" "$PKG/images.tar.gz"
echo "    取回 $(( (T1 - T0) > 0 ? TAR_SIZE / 1048576 / (T1 - T0) : TAR_SIZE / 1048576 )) MiB/s，摘要一致"
sha_of() { git show "HEAD:$1" | sha256sum | cut -d' ' -f1; }
{
  echo "SCHEMA=ai-platform-image-package/1"
  echo "PACKAGED_BY=dev/build-images.sh"
  echo "SOURCE_COMMIT=$LOCAL_SHA"
  echo "SOURCE_TREE=$(git rev-parse 'HEAD^{tree}')"
  echo "SOURCE_TRANSPORT=git-archive"
  echo "DOCKERFILE_BACKEND_SHA256=$(sha_of docker/Dockerfile.backend)"
  echo "DOCKERFILE_FRONTEND_SHA256=$(sha_of docker/Dockerfile.frontend)"
  echo "BACKEND_LOCK_SHA256=$(sha_of backend/package-lock.json)"
  echo "FRONTEND_LOCK_SHA256=$(sha_of frontend/package-lock.json)"
  echo "COMPOSE_SHA256=$(sha_of docker-compose.yml)"
  echo "DOCKERIGNORE_SHA256=$(sha_of .dockerignore)"
  echo "TARGET_PLATFORM=$TARGET_PLATFORM"
  echo "TARGET_HOST=$TARGET_HOST"
  echo "BUILD_HOST=$BUILD_HOST"
  echo "PRECHECK_FILE=$PRECHECK_FILE"
  echo "FETCHED_AT=$(date -u +%FT%TZ)"
  cat "$PKG/MANIFEST.remote.env"
} > "$PKG/MANIFEST.env"
rm -f "$PKG/MANIFEST.remote.env"
python3 - "$PKG/MANIFEST.env" "$PKG/MANIFEST.json" <<'PY' 2>/dev/null || echo "    （本机没有 python3，只写了 MANIFEST.env）"
import json, sys
rows = [l.rstrip("\n").split("=", 1) for l in open(sys.argv[1], encoding="utf-8") if "=" in l]
json.dump({k: v for k, v in rows}, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
echo "    清单: $PKG/MANIFEST.env"

# ---------- 6. 清理构建主机 ----------
if [ "$KEEP_REMOTE" = 1 ]; then
  echo "    按 --keep-remote 保留构建主机任务目录 $TASK_DIR 与标签 ai-platform-{backend,frontend}:$TASK"
else
  $SSH_B "docker rmi 'ai-platform-backend:$TASK' 'ai-platform-frontend:$TASK' >/dev/null 2>&1; rm -rf '$TASK_DIR'; echo '    已删除构建主机上的任务目录与两个任务标签（只删这两个标签，不 prune、不碰其他镜像）'"
fi
echo ""
echo "✅ 镜像包就绪: $PKG"
echo "   下一步（先核 make status-docker 的现状）: make deploy-docker ARGS=--prebuilt=$PKG"
