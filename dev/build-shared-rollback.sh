#!/usr/bin/env bash
# Local/approved build host only. Does not connect to or deploy to a server.
set -euo pipefail
umask 077
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[ "$#" = 2 ] && [ "$1" = --build ] || { echo 'Usage: bash dev/build-shared-rollback.sh --build NEW_ABSOLUTE_OUTPUT_DIR'; exit 2; }
OUT=$2
[[ "$OUT" = /* ]] && [ ! -e "$OUT" ] || { echo 'STOP: output must be new and absolute'; exit 2; }
CANDIDATE=$(node "$ROOT/dev/shared-rollback-bind.cjs" source "$ROOT")
# Same conservative resource floor as the native image builder; never clean or lower it.
bash "$ROOT/dev/docker-release-preflight.sh" resources 8 4864 100000 shared-rollback-build
[ "$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')" = linux/amd64 ] || { echo 'STOP: expected verified amd64 build host'; exit 2; }
mkdir -m 700 "$OUT"
mkdir "$OUT/src"
git -C "$ROOT" archive "$CANDIDATE" | tar -x -C "$OUT/src"
# Carry the exact sibling commit to the deployment checkout without a branch switch.
git -C "$ROOT" bundle create "$OUT/source.bundle" "refs/heads/codex/share-rollback-20261111"
[ "$(git -C "$ROOT" bundle list-heads "$OUT/source.bundle" | cut -d' ' -f1)" = "$CANDIDATE" ] || exit 2
TAG="ai-platform-backend:shared-rollback-${CANDIDATE}"
DOCKER_BUILDKIT=0 docker build --memory=4608m --memory-swap=4608m --cpu-shares=256 \
  --label "org.opencontainers.image.revision=$CANDIDATE" -f "$OUT/src/docker/Dockerfile.backend" -t "$TAG" "$OUT/src" > "$OUT/build.log" 2>&1
IMAGE=$(docker image inspect "$TAG" --format '{{.Id}}')
node - "$OUT" "$CANDIDATE" "$IMAGE" <<'NODE'
const fs=require('fs');const [out,source_commit,backend_image_id]=process.argv.slice(2);
fs.writeFileSync(out+'/manifest.json',JSON.stringify({source_commit,backend_image_id},null,2)+'\n',{flag:'wx',mode:0o600});
NODE
node "$ROOT/dev/shared-rollback-bind.cjs" image "$ROOT" "$OUT/manifest.json" > "$OUT/VERIFIED.txt"
docker save "$IMAGE" | gzip -1 > "$OUT/backend.tar.gz"
(cd "$OUT" && sha256sum source.bundle backend.tar.gz manifest.json VERIFIED.txt > SHA256SUMS)
echo "Prepared compatible fallback at $OUT; no deployment, cleanup or service restart."
