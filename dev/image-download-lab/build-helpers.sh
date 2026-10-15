#!/usr/bin/env bash
# 把 imageHelpers.js 打成浏览器可直接加载的 IIFE（antd 用替身），供 server.py 的实验页加载。
#   build-helpers.sh <源码树根> <输出目录> <标签 old|new>
set -euo pipefail
ROOT="$1"; OUT="$2"; TAG="$3"
mkdir -p "$OUT"
"$ROOT/frontend/node_modules/.bin/esbuild" "$ROOT/frontend/src/pages/image/utils/imageHelpers.js" --bundle --format=iife --global-name=ImageHelpers \
  --alias:antd="$(dirname "$0")/antd-stub.js" --outfile="$OUT/helper-$TAG.js" --log-level=warning
echo "built $OUT/helper-$TAG.js ($(stat -c %s "$OUT/helper-$TAG.js") bytes) from $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet -- frontend/src/pages/image/utils/imageHelpers.js || echo ' + uncommitted helper changes')"
