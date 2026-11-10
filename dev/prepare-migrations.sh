#!/usr/bin/env bash
# Native first-site migration preparation; all writes require the existing human window.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${SSH_HOST:-practice}"; APP="${REMOTE_DIR:-/var/www/ai-platform}"
[ "$HOST" = practice ] && [ "$APP" = /var/www/ai-platform ] || { echo 'STOP: this prepared migration entry is bound to the original first site'; exit 2; }
PROFILE="${MIGRATION_PROFILE:-teacher-review}"
case "$PROFILE" in teacher-review|gallery-review) ;; *) echo "STOP: unknown migration profile"; exit 2;; esac
ACTION="${1:-prepare}"
case "$ACTION" in prepare|migrate) ;; *) echo 'usage: prepare-migrations.sh prepare|migrate'; exit 2;; esac
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo 'STOP: local candidate is dirty'; exit 2; }
TARGET=$(git -C "$ROOT" rev-parse HEAD)
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || exit 2
STAGE="/var/backups/ai-platform/releases/migration-$TARGET"
LOCK=/var/backups/ai-platform/releases/.lock
TOKEN="migration-$ACTION-$TARGET-$$-$(date +%s)"
VERIFY_SHA=$(sha256sum "$ROOT/dev/gallery-migrate.cjs" | cut -d' ' -f1)
PLAN_SHA=$(sha256sum "$ROOT/dev/gallery-migration-plan.json" | cut -d' ' -f1)
HELPER_SHA=$(sha256sum "$ROOT/dev/migration-stage.cjs" | cut -d' ' -f1)
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST")
LOCK_HELD=0; REMOTE_TERMINAL=0
release_lock() {
  rc=$?
  trap - EXIT
  if [ "$LOCK_HELD" = 1 ] && [ "$REMOTE_TERMINAL" != 1 ]; then
    echo "UNKNOWN: remote terminal unconfirmed; retain original lock $TOKEN; no retry or deployment" >&2
    [ "$rc" != 0 ] || rc=31
  elif [ "$LOCK_HELD" = 1 ]; then
    if ! "${SSH[@]}" bash "$APP/dev/docker-release-lock.sh" release "$LOCK" "$TOKEN"; then
      echo 'UNKNOWN: own migration lock release not confirmed; no deployment or retry' >&2
      [ "$rc" != 0 ] || rc=30
    fi
  fi
  exit "$rc"
}
trap release_lock EXIT
PARENT=""
if [ "$ACTION" = prepare ]; then
  PARENT=$("${SSH[@]}" git -C "$APP" rev-parse HEAD)
  [[ "$PARENT" =~ ^[0-9a-f]{40}$ ]] || { echo 'STOP: unreadable first-site parent'; exit 2; }
  git -C "$ROOT" merge-base --is-ancestor "$PARENT" "$TARGET"
fi
echo "目标: ai.xingyuncl.com；候选: $TARGET；阶段: $ACTION"
echo "精确迁移清单: $PROFILE；不重启应用、不删旧备份；已有迁移不重跑。"
if [ "$ACTION" = prepare ]; then
  echo "当前父版: $PARENT"
  echo '本次将传递提交对象，仅预置所选清单迁移到工作区和Git暂存区；失败保留现场。'
else
  echo '本次先校验预置与待执行名单，再运行原 make migrate 备份/迁移入口；DDL可能部分提交，失败不自动回滚或重跑。'
fi
read -rp '已取得本次具名操作范围及唯一窗口，确认执行？[y/N] ' answer
[[ "$answer" = y || "$answer" = Y ]] || exit 1
"${SSH[@]}" bash "$APP/dev/docker-release-lock.sh" acquire "$LOCK" "$TOKEN"
LOCK_HELD=1
if [ "$ACTION" = prepare ]; then
  BUNDLE=$(mktemp /tmp/ai-migrations.XXXXXX.bundle)
  # One committed object graph; no working files or credentials enter the bundle.
  git -C "$ROOT" bundle create "$BUNDLE" "$PARENT..HEAD"
  BUNDLE_SHA=$(sha256sum "$BUNDLE" | cut -d' ' -f1)
  "${SSH[@]}" bash -s -- "$STAGE" <<'REMOTE'
set -euo pipefail
umask 077
mkdir "$1"
chmod 700 "$1"
REMOTE
  scp -q -o BatchMode=yes "$BUNDLE" "$HOST:$STAGE/source.bundle"
  scp -q -o BatchMode=yes "$ROOT/dev/migration-stage.cjs" "$HOST:$STAGE/migration-stage.cjs"
  scp -q -o BatchMode=yes "$ROOT/dev/gallery-migrate.cjs" "$HOST:$STAGE/gallery-migrate.cjs"
  scp -q -o BatchMode=yes "$ROOT/dev/gallery-migration-plan.json" "$HOST:$STAGE/gallery-migration-plan.json"
  "${SSH[@]}" bash -s -- "$APP" "$STAGE" "$TARGET" "$HELPER_SHA" "$BUNDLE_SHA" "$PARENT" "$PROFILE" "$PLAN_SHA" "$VERIFY_SHA" <<'REMOTE'
set -euo pipefail
APP=$1; STAGE=$2; TARGET=$3; HELPER_SHA=$4; BUNDLE_SHA=$5; PARENT=$6; PROFILE=$7; PLAN_SHA=$8; VERIFY_SHA=$9
export NVM_DIR="$HOME/.nvm"; [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
[ "$(sha256sum "$STAGE/migration-stage.cjs" | cut -d' ' -f1)" = "$HELPER_SHA" ]
[ "$(sha256sum "$STAGE/gallery-migrate.cjs" | cut -d' ' -f1)" = "$VERIFY_SHA" ]
[ "$(sha256sum "$STAGE/gallery-migration-plan.json" | cut -d' ' -f1)" = "$PLAN_SHA" ]
[ "$(sha256sum "$STAGE/source.bundle" | cut -d' ' -f1)" = "$BUNDLE_SHA" ]
[ -z "$(git -C "$APP" status --porcelain)" ]
[ "$(git -C "$APP" rev-parse HEAD)" = "$PARENT" ]
git -C "$APP" fetch "$STAGE/source.bundle" HEAD
[ "$(git -C "$APP" rev-parse FETCH_HEAD)" = "$TARGET" ]
node "$STAGE/migration-stage.cjs" prepare "$APP" "$TARGET" "$STAGE" "$PARENT" "$PROFILE"
REMOTE
  REMOTE_TERMINAL=1
  echo "迁移预置完成；本地bundle保留供核验: $BUNDLE"
  echo '下一步在同一候选目录执行 make migrate ARGS=--prepared；尚未执行数据库迁移。'
else
  "${SSH[@]}" bash -s -- "$APP" "$STAGE" "$TARGET" "$HELPER_SHA" "$TOKEN" "$PLAN_SHA" "$VERIFY_SHA" <<'REMOTE'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"; [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
[ "$(sha256sum "$2/migration-stage.cjs" | cut -d' ' -f1)" = "$4" ]
[ "$(sha256sum "$2/gallery-migration-plan.json" | cut -d' ' -f1)" = "$6" ]
[ "$(sha256sum "$2/gallery-migrate.cjs" | cut -d' ' -f1)" = "$7" ]
node "$2/migration-stage.cjs" begin "$1" "$3" "$2" "$5"
REMOTE
  if make -C "$ROOT" migrate-native SSH_HOST="$HOST" REMOTE_DIR="$APP" BACKUP_RETENTION=skip PREPARED_TARGET="$TARGET" PREPARED_TOKEN="$TOKEN"; then
    "${SSH[@]}" bash -s -- "$APP" "$STAGE" "$TARGET" "$TOKEN" <<'REMOTE'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"; [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
node "$2/migration-stage.cjs" complete "$1" "$3" "$2" "$4"
REMOTE
    REMOTE_TERMINAL=1
  else
    # Read only the exact attempt's durable terminal receipt. SSH exit alone is not proof.
    if "${SSH[@]}" bash -s -- "$APP" "$STAGE" "$TARGET" "$TOKEN" <<'REMOTE'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"; [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
node "$2/migration-stage.cjs" verify-terminal "$1" "$3" "$2" "$4"
REMOTE
    then
      REMOTE_TERMINAL=1
      "${SSH[@]}" bash -s -- "$APP" "$STAGE" "$TARGET" <<'REMOTE' || true
set -euo pipefail
export NVM_DIR="$HOME/.nvm"; [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
node "$2/migration-stage.cjs" fail "$1" "$3" "$2"
REMOTE
    fi
    echo 'STOP: backup/migration failed or unknown; no application switch, no retry or rollback'; exit 20
  fi
  echo '所选清单迁移已核验完成；应用仍未切换，按独立发布确认继续。'
fi
