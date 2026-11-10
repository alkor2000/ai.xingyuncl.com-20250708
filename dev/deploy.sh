#!/usr/bin/env bash
# 部署到生产服务器（ai.xingyuncl.com）：把本地已提交的代码推到 GitHub，在服务器上 ff-only 拉取，
# 先做数据库备份门，再运行服务器自带的 rebuild.sh --full（环境检查→前端构建→PM2 重启→健康检查），
# 最后打 deploy-<时间戳> 标签并远程健康检查。
#
# 用法: make deploy            （显示将部署的提交并二次确认）
#       make deploy ARGS=-y    （跳过确认，仅用于自动化）
#       make deploy ARGS=--server-first （首站构建/健康通过后再推 GitHub，使用 bundle 传码）
#       make deploy ARGS="--server-first --code-only" （纯代码发布：差量含迁移或启动文件即拒绝；备份门只新增备份、不删旧备份）
# 环境变量: SSH_HOST=practice  REMOTE_DIR=/var/www/ai-platform  HEALTH_URL=https://ai.xingyuncl.com/health
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${SSH_HOST:-practice}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/ai-platform}"
HEALTH_URL="${HEALTH_URL:-https://ai.xingyuncl.com/health}"
BRANCH="$(git -C "$ROOT" branch --show-current)"
ASSUME_YES=0; SERVER_FIRST=0; CODE_ONLY=0; KEEP_HISTORY=0; PREPARED_MIGRATIONS=0
# 纯代码发布不许包含的路径：会碰库、或会改容器启动方式的文件（与 dev/deploy-docker.sh 同一份清单）。
CODE_ONLY_FORBIDDEN='^(backend/migrations/|backend/knexfile\.js$|database/|tools/database-upgrade/|docker/|docker-compose\.yml$)'
for arg in "$@"; do
  case "$arg" in
    -y) ASSUME_YES=1 ;;
    --server-first) SERVER_FIRST=1 ;;
    --code-only) CODE_ONLY=1 ;;
    --keep-history) KEEP_HISTORY=1 ;;
    --prepared-migrations) PREPARED_MIGRATIONS=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done
if [ "$PREPARED_MIGRATIONS" = 1 ]; then
  [ "$CODE_ONLY" = 0 ] && [ "$SERVER_FIRST" = 1 ] && [ "$KEEP_HISTORY" = 1 ] || { echo 'STOP: prepared migrations require --server-first --keep-history and exclude --code-only'; exit 2; }
fi

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
TARGET_FULL=$(git rev-parse HEAD)
STAGE="/var/backups/ai-platform/releases/migration-$TARGET_FULL"
STAGE_HELPER_SHA=""; STAGE_PLAN_SHA=""; STAGE_VERIFY_SHA=""
if [ "$PREPARED_MIGRATIONS" = 1 ]; then STAGE_HELPER_SHA=$(sha256sum "$ROOT/dev/migration-stage.cjs" | cut -d' ' -f1); STAGE_PLAN_SHA=$(sha256sum "$ROOT/dev/gallery-migration-plan.json" | cut -d' ' -f1); STAGE_VERIFY_SHA=$(sha256sum "$ROOT/dev/gallery-migrate.cjs" | cut -d' ' -f1); fi
REMOTE_SHA=$(ssh -n -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR && git rev-parse --short HEAD")
git merge-base --is-ancestor "$REMOTE_SHA" HEAD || { echo "❌ 首站提交不是本地 HEAD 的祖先，中止。"; exit 1; }
if [ "$CODE_ONLY" = 1 ]; then
  NOT_CODE=$(git --no-pager diff --no-renames --name-only "$REMOTE_SHA" "$LOCAL_SHA" | grep -E "$CODE_ONLY_FORBIDDEN" || true)
  if [ -n "$NOT_CODE" ]; then
    echo "❌ --code-only 只发纯代码。首站 $REMOTE_SHA 到本提交之间有这些会碰库或改启动方式的文件，请走常规发布："; echo "$NOT_CODE" | sed 's/^/    /'; exit 1
  fi
fi
echo ""
echo "================ 部署预览 ================"
echo "  服务器当前:  $REMOTE_SHA"
echo "  将部署到:    $LOCAL_SHA"
echo "  变更提交:"
git --no-pager log --oneline "$REMOTE_SHA..$LOCAL_SHA" 2>/dev/null | sed 's/^/    /' || echo "    (无法比较，可能服务器领先或分叉)"
echo "  变更文件:"
git --no-pager diff --stat "$REMOTE_SHA..$LOCAL_SHA" 2>/dev/null | tail -1 | sed 's/^/    /' || true
if git --no-pager diff --name-only "$REMOTE_SHA..$LOCAL_SHA" 2>/dev/null | grep -q '^backend/migrations/'; then
  if [ "$PREPARED_MIGRATIONS" = 1 ]; then
    echo "  迁移要求: 所选精确清单预置迁移必须已有匹配本候选的成功回执；应用切换前再次校验"
  else
    echo "  ⚠ 本次含 knex 迁移文件：rebuild.sh 不跑迁移；加法迁移须先完成，不得发布后补迁移"
  fi
fi
if [ "$CODE_ONLY" = 1 ]; then
  echo "  发布方式:    纯代码（--code-only）：差量不含迁移与启动文件；备份门只新增备份、不删旧备份；重启不清历史日志"
  if [ "$SERVER_FIRST" = 1 ]; then
    echo "  确认后会做:  备份一份库 → 传码并 ff-only 合并 → 构建前端 → 重启 PM2（后端几秒不可用）→ 健康检查通过后推送 GitHub $BRANCH → 打 deploy 标签并推送"
  else
    echo "  确认后会做:  备份一份库 → 服务器 ff-only 合并（GitHub $BRANCH 已在预览前推送）→ 构建前端 → 重启 PM2（后端几秒不可用）→ 打 deploy 标签并推送"
  fi
fi
if [ "$KEEP_HISTORY" = 1 ]; then echo "  历史保留: 不清理旧数据库备份及重启日志；迁移策略不由该选项改变"; fi
echo "=========================================="
if [ "$ASSUME_YES" != 1 ]; then
  read -rp "确认部署到生产 ai.xingyuncl.com? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "已取消"; exit 1; }
fi

# Prepared application switching shares the SAME native lock as migration preparation.
# A lost SSH may leave backup/rebuild running: only confirmed terminal success permits
# automatic release. The original owner must reconcile any unknown outcome.
PREPARED_LOCK=/var/backups/ai-platform/releases/.lock
PREPARED_TOKEN="teacher-deploy-$TARGET_FULL-$$-$(date +%s)"
PREPARED_LOCK_HELD=0; PREPARED_REMOTE_TERMINAL=0; PREPARED_CHECKS_SUCCEEDED=0; BUNDLE=""
finish_deploy() {
  rc=$?
  trap - EXIT
  if [ "$PREPARED_LOCK_HELD" = 1 ] && { [ "$PREPARED_REMOTE_TERMINAL" != 1 ] || [ "$PREPARED_CHECKS_SUCCEEDED" != 1 ] || [ "$rc" != 0 ]; }; then
    echo "STOP: remote completion is not full verification; retain original lock $PREPARED_TOKEN and staged evidence; no retry/unlock" >&2
    [ "$rc" != 0 ] || rc=31
  else
    if [ -n "$BUNDLE" ]; then rm -f -- "$BUNDLE"; fi
    if [ "$PREPARED_LOCK_HELD" = 1 ]; then
      if ! ssh -n -o BatchMode=yes "$SSH_HOST" bash "$REMOTE_DIR/dev/docker-release-lock.sh" release "$PREPARED_LOCK" "$PREPARED_TOKEN"; then
        echo 'UNKNOWN: own prepared deployment lock release not confirmed' >&2
        [ "$rc" != 0 ] || rc=30
      fi
    fi
  fi
  exit "$rc"
}
trap finish_deploy EXIT
if [ "$PREPARED_MIGRATIONS" = 1 ]; then
  ssh -n -o BatchMode=yes "$SSH_HOST" bash "$REMOTE_DIR/dev/docker-release-lock.sh" acquire "$PREPARED_LOCK" "$PREPARED_TOKEN"
  PREPARED_LOCK_HELD=1
fi

# 3. 备份门：发布前先做一份数据库备份（约 112MB 库，几秒钟）
echo "==> 发布前数据库备份 ..."
BACKUP_ENV="APP_DIR=$REMOTE_DIR"
if [ "$CODE_ONLY" = 1 ] || [ "$KEEP_HISTORY" = 1 ]; then BACKUP_ENV="$BACKUP_ENV BACKUP_RETENTION=skip"; fi
BK=$(ssh -o BatchMode=yes "$SSH_HOST" "$BACKUP_ENV bash -s" < "$ROOT/backend/scripts/db_backup.sh")
echo "    备份: $BK"

# 首站优先时只传已提交对象，不同步工作区、配置或上传数据。
if [ "$SERVER_FIRST" = 1 ] && [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  BUNDLE=$(mktemp /tmp/ai-platform-release.XXXXXX.bundle)
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
if [ "$PREPARED_MIGRATIONS" = 1 ]; then
  [ "\$(sha256sum '$STAGE/migration-stage.cjs' | cut -d' ' -f1)" = "$STAGE_HELPER_SHA" ] || { echo 'STOP: staged verifier bytes changed'; exit 1; }
  [ "\$(sha256sum '$STAGE/gallery-migration-plan.json' | cut -d' ' -f1)" = "$STAGE_PLAN_SHA" ] || { echo 'STOP: staged plan bytes changed'; exit 1; }
  [ "\$(sha256sum '$STAGE/gallery-migrate.cjs' | cut -d' ' -f1)" = "$STAGE_VERIFY_SHA" ] || { echo 'STOP: staged database verifier bytes changed'; exit 1; }
  node "$STAGE/migration-stage.cjs" verify-completed "$REMOTE_DIR" "$TARGET_FULL" "$STAGE" || exit 1
elif [ -n "\$(git status --porcelain)" ]; then
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
# 纯代码发布不删历史日志：rebuild.sh 刚随本次提交合入，核一下它认这个开关，不认就不重启。
if [ "$CODE_ONLY" = 1 ] || [ "$KEEP_HISTORY" = 1 ]; then
  grep -q REBUILD_KEEP_LOGS rebuild.sh || { echo "❌ 服务器上的 rebuild.sh 不支持保留日志，中止；服务没有重启。"; exit 1; }
  export REBUILD_KEEP_LOGS=1
fi
bash rebuild.sh --full
EOF
if [ "$PREPARED_MIGRATIONS" = 1 ]; then PREPARED_REMOTE_TERMINAL=1; fi

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

# Both public health checks and the publication tail have completed successfully.
PREPARED_CHECKS_SUCCEEDED=1
