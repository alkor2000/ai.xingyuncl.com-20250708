#!/usr/bin/env bash
# One incident, one native lock, one new stage. A reviewed candidate is not approval.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${SSH_HOST:-practice}"; APP="${REMOTE_DIR:-/var/www/ai-platform}"
[ "$HOST" = practice ] && [ "$APP" = /var/www/ai-platform ] || { echo 'STOP: recovery is practice only'; exit 2; }
[[ "${APPROVAL_REFERENCE:-}" =~ ^[A-Za-z0-9_.:-]{1,200}$ ]] || { echo 'STOP: missing explicit owner approval reference'; exit 2; }
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo 'STOP: dirty recovery candidate'; exit 2; }
TARGET=$(git -C "$ROOT" rev-parse HEAD)
OLD=f0b94dcb4ba099418eee8442f53ca1dd759ca043
[ "$TARGET" != "$OLD" ]; git -C "$ROOT" merge-base --is-ancestor "$OLD" "$TARGET"
node - "$ROOT" "$OLD" "$TARGET" <<'JS'
const r=process.argv[2],cp=require('node:child_process'),allowed=require(r+'/dev/gallery-recovery.cjs').toolPaths;
const changed=cp.execFileSync('git',['-C',r,'diff','--name-only',process.argv[3],process.argv[4]],{encoding:'utf8'}).trim().split('\n');
if(!changed.length||changed.some(x=>!allowed.includes(x)))throw Error('Recovery candidate changes business or migrations');
JS
STAGE="/var/backups/ai-platform/releases/migration-$TARGET"
LOCK=/var/backups/ai-platform/releases/.lock
TOKEN="gallery-recovery-${TARGET:0:12}-$$-$(date +%s)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST")
HELD=0; VERIFIED=0
finish(){
 rc=$?;trap - EXIT
 if [ "$HELD" = 1 ]; then
  if [ "$VERIFIED" = 1 ] && [ "$rc" = 0 ]; then
   "${SSH[@]}" bash "$APP/dev/docker-release-lock.sh" release "$LOCK" "$TOKEN" || rc=30
  else
   echo "STOP: retain native lock $TOKEN; inspect parameter restoration and failure evidence; no retry/unlock/application switch" >&2
   [ "$rc" != 0 ] || rc=31
  fi
 fi
 exit "$rc"
}
trap finish EXIT
printf 'Practice recovery: %s; original failed stage: %s\n' "$TARGET" "$OLD"
echo 'Only original 003; temporary GLOBAL 1 then restore 0; old receipts preserved; no PKU operations.'
read -rp 'Owner approved this candidate, parameter change, and window? [y/N] ' answer
[[ "$answer" = y || "$answer" = Y ]] || exit 1
"${SSH[@]}" bash "$APP/dev/docker-release-lock.sh" acquire "$LOCK" "$TOKEN";HELD=1
BUNDLE=$(mktemp /tmp/gallery-recovery.XXXXXX.bundle)
git -C "$ROOT" bundle create "$BUNDLE" "$OLD..HEAD"
BUNDLE_SHA=$(sha256sum "$BUNDLE" | cut -d' ' -f1)
"${SSH[@]}" bash -s -- "$STAGE" <<'REMOTE'
set -euo pipefail
umask 077
mkdir "$1"
chmod 700 "$1"
REMOTE
scp -q -o BatchMode=yes "$BUNDLE" "$HOST:$STAGE/source.bundle"
for name in migration-stage.cjs gallery-migrate.cjs gallery-migration-plan.json gallery-recovery.cjs gallery-recovery-incident.json; do
 scp -q -o BatchMode=yes "$ROOT/dev/$name" "$HOST:$STAGE/$name"
done
# Pin helper bytes to the local reviewed commit before any helper can execute.
HASHES=$(node - "$ROOT" <<'JS'
const fs=require('node:fs'),crypto=require('node:crypto'),r=process.argv[2];
for(const n of require(r+'/dev/gallery-recovery.cjs').stagedTools)console.log(crypto.createHash('sha256').update(fs.readFileSync(r+'/dev/'+n)).digest('hex')+'  '+n);
JS
)
"${SSH[@]}" bash -s -- "$APP" "$STAGE" "$TARGET" "$TOKEN" "$APPROVAL_REFERENCE" "$BUNDLE_SHA" "$HASHES" <<'REMOTE'
set -euo pipefail
APP=$1;STAGE=$2;TARGET=$3;TOKEN=$4;APPROVAL=$5
export NVM_DIR="$HOME/.nvm";[ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
[ "$(sha256sum "$STAGE/source.bundle" | cut -d' ' -f1)" = "$6" ]
(cd "$STAGE";printf '%s\n' "$7" | sha256sum --check --strict -)
git -C "$APP" fetch "$STAGE/source.bundle" HEAD
[ "$(git -C "$APP" rev-parse FETCH_HEAD)" = "$TARGET" ]
# Node records restoration intent before SET; normal errors/signals attempt restoration.
# SIGKILL/host failure cannot guarantee restoration: durable intent + retained lock
# require the operator to recheck with an independent administrator connection.
node "$STAGE/gallery-recovery.cjs" "$APP" "$TARGET" "$STAGE" "$TOKEN" "$APPROVAL"
node "$STAGE/migration-stage.cjs" verify-completed "$APP" "$TARGET" "$STAGE"
REMOTE
VERIFIED=1
echo 'Recovery and parameter restoration verified; application unchanged. Continue only via native prepared deployment after approved preflight.'
