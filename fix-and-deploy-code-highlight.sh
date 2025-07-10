#!/bin/bash

# AI Platform 代码高亮功能修复和部署脚本
set -e

echo "🔧 AI Platform 代码高亮功能修复开始..."

# 1. 检查当前目录
cd /var/www/ai-platform/frontend

# 2. 清理可能的旧依赖缓存
echo "🧹 清理依赖缓存..."
rm -rf node_modules/react-markdown 2>/dev/null || true
rm -rf node_modules/prismjs 2>/dev/null || true
rm package-lock.json 2>/dev/null || true

# 3. 安装依赖
echo "📥 安装代码高亮依赖..."
npm install react-markdown@^9.0.1 prismjs@^1.29.0 --save

# 4. 验证依赖安装
echo "🔍 验证依赖安装..."
if [ ! -f "node_modules/react-markdown/package.json" ]; then
    echo "❌ react-markdown 安装失败"
    exit 1
fi

if [ ! -f "node_modules/prismjs/package.json" ]; then
    echo "❌ prismjs 安装失败" 
    exit 1
fi

echo "✅ 依赖安装验证成功"

# 5. 清理旧的构建文件
echo "🧹 清理旧构建文件..."
rm -rf dist

# 6. 重新构建前端
echo "🔨 重新构建前端..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 前端构建仍然失败！"
    echo "请检查组件代码是否有语法错误"
    exit 1
fi

echo "✅ 前端构建成功"

# 7. 重启前端服务
echo "🔄 重启前端服务..."
cd /var/www/ai-platform
pm2 restart ai-platform-frontend

# 8. 等待服务启动
echo "⏳ 等待服务重启..."
sleep 5

# 9. 验证服务
echo "🔍 验证服务状态..."
pm2 status

# 10. 测试前端访问
echo "🌐 测试前端服务..."
frontend_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)
if [ "$frontend_status" = "200" ]; then
    echo "✅ 前端服务正常访问 (HTTP $frontend_status)"
else
    echo "⚠️ 前端服务访问异常 (HTTP $frontend_status)"
fi

# 11. 显示最新日志
echo "📋 显示前端服务日志..."
pm2 logs ai-platform-frontend --lines 10 --nostream

echo ""
echo "🎉 代码高亮功能修复完成！"
echo "================================"
echo "🌐 访问地址: https://ai.xingyuncl.com"
echo "🆕 新功能已部署:"
echo "  ✨ Markdown代码块语法高亮"
echo "  📋 一键复制代码功能" 
echo "  🎨 20+编程语言支持"
echo "  📱 移动端适配优化"

