#!/usr/bin/env bash
# 部署到生产服务器（ai.xingyuncl.com）：把本地已提交的代码推到 GitHub，在服务器上 ff-only 拉取，
# 先做数据库备份门，再运行服务器自带的 rebuild.sh --full（环境检查→前端构建→PM2 重启→健康检查），
# 最后打 deploy-<时间戳> 标签并远程健康检查。
#
# 用法: make deploy            （显示将部署的提交并二次确认）
#       make deploy ARGS=-y    （跳过确认，仅用于自动化）
#       make deploy ARGS=--server-first （首站构建/健康通过后再推 GitHub，使用 bundle 传码）
# 环境变量: SSH_HOST=practice  REMOTE_DIR=/var/www/ai-platform  HEALTH_URL=https://ai.xingyuncl.com/health
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${SSH_HOST:-practice}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/ai-platform}"
HEALTH_URL="${HEALTH_URL:-https://ai.xingyuncl.com/health}"
BRANCH="$(git -C "$ROOT" branch --show-current)"
ASSUME_YES=0; SERVER_FIRST=0
for arg in "$@"; do
  case "$arg" in
    -y) ASSUME_YES=1 ;;
    --server-first) SERVER_FIRST=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

cd "$ROOT"

# 1. 本地必须干净且已构建通过
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 本地有未提交改动，请先提交："; git status --short; exit 1
fi
echo "==> 本地验证构建..."
make -s build

push_branch() {
echo "==> 推送到 GitHub ($BRANCH)..."
if ! git push origin "$BRANCH"; then
  echo "❌ 推送失败。请把 ~/.ssh/id_ed25519_github.pub 加到本仓库 Settings → Deploy keys（勾选 Allow write access）；origin 走 ssh 别名 github-practice。"
  exit 1
fi
}
if [ "$SERVER_FIRST" = 1 ]; then
  git fetch -q origin
  git merge-base --is-ancestor "origin/$BRANCH" HEAD || { echo "❌ GitHub 有尚未合入的提交，中止。"; exit 1; }
else
  push_branch
fi

# 2. 显示即将部署的内容
LOCAL_SHA=$(git rev-parse --short HEAD)
REMOTE_SHA=$(ssh -n -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR && git rev-parse --short HEAD")
git merge-base --is-ancestor "$REMOTE_SHA" HEAD || { echo "❌ 首站提交不是本地 HEAD 的祖先，中止。"; exit 1; }
echo ""
echo "================ 部署预览 ================"
echo "  服务器当前:  $REMOTE_SHA"
echo "  将部署到:    $LOCAL_SHA"
echo "  变更提交:"
git --no-pager log --oneline "$REMOTE_SHA..$LOCAL_SHA" 2>/dev/null | sed 's/^/    /' || echo "    (无法比较，可能服务器领先或分叉)"
echo "  变更文件:"
git --no-pager diff --stat "$REMOTE_SHA..$LOCAL_SHA" 2>/dev/null | tail -1 | sed 's/^/    /' || true
if git --no-pager diff --name-only "$REMOTE_SHA..$LOCAL_SHA" 2>/dev/null | grep -q '^backend/migrations/'; then
  echo "  ⚠ 本次含 knex 迁移文件：rebuild.sh 不跑迁移，发布后按 dev/RELEASE.md 第三节执行 make migrate-status / make migrate"
fi
echo "=========================================="
if [ "$ASSUME_YES" != 1 ]; then
  read -rp "确认部署到生产 ai.xingyuncl.com? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "已取消"; exit 1; }
fi

# 3. 备份门：发布前先做一份数据库备份（约 112MB 库，几秒钟）
echo "==> 发布前数据库备份 ..."
BK=$(ssh -o BatchMode=yes "$SSH_HOST" "APP_DIR=$REMOTE_DIR bash -s" < "$ROOT/backend/scripts/db_backup.sh")
echo "    备份: $BK"

# 首站优先时只传已提交对象，不同步工作区、配置或上传数据。
if [ "$SERVER_FIRST" = 1 ] && [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  BUNDLE=$(mktemp /tmp/ai-platform-release.XXXXXX.bundle)
  trap 'rm -f "$BUNDLE"' EXIT
  git bundle create "$BUNDLE" "$REMOTE_SHA..$BRANCH"
  scp -q -o BatchMode=yes "$BUNDLE" "$SSH_HOST:/var/tmp/ai-platform-$LOCAL_SHA.bundle"
fi

# 4. 服务器：拉代码（要求快进，若分叉则停下）并跑 rebuild.sh --full
echo "==> 服务器 git pull + rebuild.sh --full ..."
ssh -o BatchMode=yes "$SSH_HOST" bash -s <<EOF
set -e
export NVM_DIR="\$HOME/.nvm"; [ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
cd $REMOTE_DIR
if [ "\$(git rev-parse --short HEAD)" != "$REMOTE_SHA" ]; then
  echo "❌ 首站在预览后发生变化，中止。"; exit 1
fi
if [ "$SERVER_FIRST" = 1 ]; then
  if [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
    TARGET=HEAD
  else
    git fetch /var/tmp/ai-platform-$LOCAL_SHA.bundle $BRANCH
    TARGET=FETCH_HEAD
  fi
else
  git fetch origin
  TARGET=origin/$BRANCH
fi
if [ "\$(git rev-parse --short \$TARGET)" != "$LOCAL_SHA" ]; then
  echo "❌ 目标版本与本地发布版本不一致，中止。"; exit 1
fi
if ! git merge-base --is-ancestor HEAD \$TARGET; then
  echo "❌ 服务器 HEAD 不是 origin/$BRANCH 的祖先（服务器有本地提交或已分叉），中止。"
  git status -sb | head -1
  exit 1
fi
if [ -n "\$(git status --porcelain)" ]; then
  echo "❌ 服务器工作区不干净（有人直接改了生产文件），中止："; git status --short | head -20; exit 1
fi
git checkout -q $BRANCH
git merge --ff-only \$TARGET
[ "$SERVER_FIRST" != 1 ] || rm -f /var/tmp/ai-platform-$LOCAL_SHA.bundle
echo "服务器现在位于: \$(git rev-parse --short HEAD)"
if git diff --name-only $REMOTE_SHA HEAD | grep -qE '^backend/(package(-lock)?\.json)$'; then
  echo "==> backend 依赖有变化，npm ci --omit=dev ..."; ( cd backend && npm ci --omit=dev --no-audit --no-fund )
fi
if git diff --name-only $REMOTE_SHA HEAD | grep -qE '^frontend/(package(-lock)?\.json)$'; then
  echo "==> frontend 依赖有变化，npm ci ..."; ( cd frontend && npm ci --no-audit --no-fund )
fi
bash rebuild.sh --full
EOF

# 首站运行健康才更新 GitHub；推送冲突时停在首站，不继续 Docker 发布。
echo "==> 首站健康检查 ..."
curl -sf -m 15 "$HEALTH_URL" || { echo "❌ 健康检查失败"; exit 1; }
if [ "$SERVER_FIRST" = 1 ]; then push_branch; fi

# 5. 打部署 tag
TAG="deploy-$(date +%Y%m%d_%H%M%S)"
git tag -a "$TAG" -m "deploy $LOCAL_SHA to production"
git push origin "$TAG" || echo "⚠ tag 推送失败（本地已打 $TAG）"
echo ""
echo "✅ 部署完成，已打标签 $TAG"
echo "   线上健康检查:"; curl -sf -m 15 "$HEALTH_URL" && echo || { echo "❌ 健康检查失败"; exit 1; }
