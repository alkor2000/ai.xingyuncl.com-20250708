#!/usr/bin/env bash
# 同时启动后端 (:4000, nodemon 热重启) 和前端 vite dev server (:3000, 已代理 /api → 4000)。
# Ctrl-C 会一起干净地停掉两者。浏览器打开 http://localhost:3000
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null || { echo "node 未安装"; exit 1; }
[ -f "$ROOT/backend/.env" ] || { echo "缺少 backend/.env（见 dev/README.md 首次准备）"; exit 1; }
[ -d "$ROOT/backend/node_modules" ] || { echo "后端依赖缺失，先跑 make setup"; exit 1; }
[ -d "$ROOT/frontend/node_modules" ] || { echo "前端依赖缺失，先跑 make setup"; exit 1; }
mkdir -p "$ROOT/logs" "$ROOT/storage/uploads" "$ROOT/storage/temp"

pids=()
cleanup() { echo; echo "停止..."; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

echo "▶ 后端 :4000 ..."
# 注意：package.json 的 dev/start 指向 src/app.js（只导出 app 不监听），真正的入口是 src/server.js（与 PM2 一致）
( cd "$ROOT/backend" && exec npx nodemon --quiet --watch src --ext js,json src/server.js ) & pids+=($!)

for i in $(seq 1 60); do curl -sf http://127.0.0.1:4000/health >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://127.0.0.1:4000/health >/dev/null 2>&1 || echo "⚠ 后端 60 秒内未就绪，看上面的日志"

echo "▶ 前端 :3000 ..."
( cd "$ROOT/frontend" && exec npm run dev -- --host 127.0.0.1 --port 3000 ) & pids+=($!)

echo ""
echo "  后端 API:   http://localhost:4000  （/health）"
echo "  前端(开发): http://localhost:3000  ← 在浏览器打开这个"
echo "  Ctrl-C 停止"
wait
