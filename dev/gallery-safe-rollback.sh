#!/usr/bin/env bash
# Run on the named server in the reviewed candidate checkout, under real approval.
# No naked switch, no schema down, no automatic thaw or release of a failed attempt.
set -euo pipefail
umask 077
MODE=${1:-}; REL=${2:-}; TARGET=${3:-}; APPROVAL=${4:-}; TOKEN=${5:-}
if [ "$#" != 5 ] || ! [[ "$MODE" =~ ^(docker|pm2)$ ]] || ! [[ "$APPROVAL" =~ ^[A-Za-z0-9_.:-]{1,200}$ ]] || ! [[ "$TOKEN" =~ ^[A-Za-z0-9._-]{8,80}$ ]]; then
  echo 'usage (server): bash dev/gallery-safe-rollback.sh docker|pm2 RELEASE_DIR recorded-images|PARENT_SHA APPROVAL_REFERENCE OWN_LOCK_TOKEN' >&2; exit 2
fi
APP=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[ "$APP" = /var/www/ai-platform ] || { echo 'STOP: this rollback entry is bound to /var/www/ai-platform'; exit 2; }
BASE=/var/backups/ai-platform/releases
REL=$(realpath -e "$REL")
[[ "$REL" = "$BASE/"* ]] && [[ "${REL##*/}" =~ ^[A-Za-z0-9._-]+$ ]] && [ -d "$REL" ] || exit 2
LOCK="$BASE/.lock"
export NVM_DIR="$HOME/.nvm"; [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
cd "$APP"
git diff --quiet && git diff --cached --quiet || { echo 'STOP: tracked source changed'; exit 2; }
if [ -d "$LOCK" ]; then
  grep -qx "token=$TOKEN" "$LOCK/owner" || { echo 'STOP: lock belongs to another operator'; exit 3; }
else
  bash dev/docker-release-lock.sh acquire "$LOCK" "$TOKEN"
fi
trap 'rc=$?; if [ "$rc" != 0 ]; then echo "STOP: retain lock, evidence and any committed freeze; no retry, down or public restore" >&2; fi' EXIT
# A failed prior attempt requires original-owner reconciliation, never implicit retry.
if compgen -G "$REL/safe-rollback-*" >/dev/null; then echo 'STOP: existing rollback attempt; reconcile it first' >&2; exit 3; fi
EVIDENCE="$REL/safe-rollback-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$EVIDENCE"
for file in gallery-freeze-gate.cjs gallery-migrate.cjs gallery-migration-plan.json; do
  want=$(git show "HEAD:dev/$file" | sha256sum | cut -d' ' -f1)
  cp "dev/$file" "$EVIDENCE/$file"
  [ "$(sha256sum "$EVIDENCE/$file" | cut -d' ' -f1)" = "$want" ] || exit 2
  chmod 600 "$EVIDENCE/$file"
done
if [ "$MODE" = docker ]; then
  [ "$TARGET" = recorded-images ] && [ -f "$REL/rollback.override.yml" ] && [ -f "$REL/release.override.yml" ] || exit 2
  [ "$(sed -n 's/^SOURCE_COMMIT=//p' "$REL/RELEASE.txt")" = "$(git rev-parse HEAD)" ] || { echo 'STOP: release source differs from reviewed checkout'; exit 2; }
  grep -Fq 'command: ["su-exec", "nodejs", "node", "src/server.js"]' "$REL/rollback.override.yml" || { echo 'STOP: rollback would run uncontrolled startup migrations'; exit 2; }
  OLD_B=$(sed -n 's/^    image: \(ai-platform-backend:rollback-[0-9_]*\)$/\1/p' "$REL/rollback.override.yml")
  OLD_F=$(sed -n 's/^    image: \(ai-platform-frontend:rollback-[0-9_]*\)$/\1/p' "$REL/rollback.override.yml")
  [[ "$OLD_B" =~ ^ai-platform-backend:rollback-[0-9]{8}_[0-9]{6}$ ]] && [[ "$OLD_F" =~ ^ai-platform-frontend:rollback-[0-9]{8}_[0-9]{6}$ ]] || exit 2
  [ "${OLD_B#*:}" = "${OLD_F#*:}" ] || exit 2
  OLD_B_ID=$(docker image inspect "$OLD_B" --format '{{.Id}}')
  OLD_F_ID=$(docker image inspect "$OLD_F" --format '{{.Id}}')
  [[ "$OLD_B_ID" =~ ^sha256:[a-f0-9]{64}$ ]] && [[ "$OLD_F_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 2
  # Pin the exact switch file before freeze; never substitute a later edit.
  cp "$REL/rollback.override.yml" "$EVIDENCE/rollback.override.yml"
  sha256sum "$EVIDENCE/rollback.override.yml" > "$EVIDENCE/rollback.sha256"
  HEALTH=https://ai.pkuailab.com/health
  gate() {
    docker compose -f docker-compose.yml -f "$REL/release.override.yml" run --rm --no-deps -T \
      -v "$EVIDENCE:/gallery-rollback" backend node /gallery-rollback/gallery-freeze-gate.cjs "$1" /app /gallery-rollback "$APPROVAL" </dev/null
  }
else
  [[ "$TARGET" =~ ^[a-f0-9]{40}$ ]] || exit 2
  git merge-base --is-ancestor "$TARGET" HEAD
  # The prepared receipt binds the parent; an arbitrary earlier tag is not accepted.
  node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[1]));if(p.parent!==process.argv[2]||p.target!==process.argv[3])process.exit(2)' "$REL/PREPARED.json" "$TARGET" "$(git rev-parse HEAD)"
  git show "$TARGET:rebuild.sh" | grep -q REBUILD_KEEP_LOGS || { echo 'STOP: parent cannot preserve logs'; exit 2; }
  HEALTH=https://ai.xingyuncl.com/health
  gate() { ( cd "$APP/backend"; node "$EVIDENCE/gallery-freeze-gate.cjs" "$1" "$APP/backend" "$EVIDENCE" "$APPROVAL" ); }
fi
printf 'mode=%s\ntarget=%s\napproval=%s\nlock_token=%s\n' "$MODE" "$TARGET" "$APPROVAL" "$TOKEN" > "$EVIDENCE/ROLLBACK-INTENT.txt"
gate apply
[ -s "$EVIDENCE/FREEZE-VERIFIED.json" ] || exit 2
# A fresh query of guards, frozen control and latest audit is mandatory before switch.
gate verify
grep -qx "token=$TOKEN" "$LOCK/owner" || exit 3
if [ "$MODE" = docker ]; then
  sha256sum -c "$EVIDENCE/rollback.sha256" >/dev/null
  docker compose -f docker-compose.yml -f "$EVIDENCE/rollback.override.yml" up -d backend frontend </dev/null
  [ "$(docker inspect ai-platform-backend --format '{{.Image}}')" = "$OLD_B_ID" ]
  [ "$(docker inspect ai-platform-frontend --format '{{.Image}}')" = "$OLD_F_ID" ]
  READY=0
  for i in $(seq 1 36); do
    if [ "$(docker inspect ai-platform-backend --format '{{.State.Running}} {{.State.Health.Status}}')" = 'true healthy' ] && [ "$(docker inspect ai-platform-frontend --format '{{.State.Running}} {{.State.Health.Status}}')" = 'true healthy' ]; then READY=1; break; fi
    sleep 5
  done
  [ "$READY" = 1 ] || { echo 'STOP: rollback containers not healthy; retain freeze and lock'; exit 1; }
else
  git checkout --detach "$TARGET"
  REBUILD_KEEP_LOGS=1 bash rebuild.sh --full
fi
curl -sf -m 15 "$HEALTH" >/dev/null
gate verify
printf 'application_rollback_verified=1\npublication_remains_frozen=1\n' > "$EVIDENCE/COMPLETE.txt"
bash "$APP/dev/docker-release-lock.sh" release "$LOCK" "$TOKEN"
echo 'Safe application rollback verified; publication remains frozen. No schema or audit was removed.'
