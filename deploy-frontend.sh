#!/bin/bash

# 前端部署脚本
echo "Starting frontend deployment..."

# 进入前端目录
cd /var/www/ai-platform/frontend

# 安装依赖（如果需要）
if [ ! -d "node_modules" ] || [ "$1" == "--install" ]; then
  echo "Installing dependencies..."
  npm install
fi

# 构建前端
echo "Building frontend..."
npm run build

# 检查构建结果
if [ $? -eq 0 ]; then
  echo "✅ Frontend build successful!"
  echo "📱 Mobile adaptation features:"
  echo "   - Responsive layout for mobile devices"
  echo "   - Touch-optimized interface"
  echo "   - Mobile-specific navigation"
  echo "   - Optimized input controls"
  echo ""
  echo "🌐 Access the application at: https://ai.xingyuncl.com"
  echo "📱 Test on mobile: Open on mobile device or use browser's device emulator (F12)"
else
  echo "❌ Build failed. Please check the error messages above."
  exit 1
fi
