#!/bin/bash

set -e
echo "🔧 修复 Prism.js 构建问题..."

cd /var/www/ai-platform/frontend

# 1. 清理构建缓存
echo "🧹 清理构建缓存..."
rm -rf dist .vite node_modules/.vite

# 2. 重新构建
echo "🔨 重新构建前端..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 构建仍然失败"
    echo "尝试降级方案..."
    exit 1
fi

echo "✅ 构建成功！"

# 3. 重启前端服务
echo "🔄 重启前端服务..."
cd /var/www/ai-platform
pm2 restart ai-platform-frontend

echo "✅ 代码高亮功能部署成功！"

