#!/bin/bash

# AI Platform 启动脚本

echo "🚀 启动 AI Platform..."

# 进入项目目录
cd /var/www/ai-platform

# 检查并创建日志目录
echo "📁 创建日志目录..."
mkdir -p logs/backend/auth
mkdir -p logs/backend/chat
mkdir -p logs/backend/file
mkdir -p logs/backend/admin

# 启动PM2进程
echo "🔄 启动后端服务..."
pm2 start ecosystem.config.js

# 显示PM2状态
echo "📊 服务状态:"
pm2 status

echo "✅ AI Platform 启动完成!"
echo "🌍 访问地址: https://ai.xingyuncl.com"
echo "🔍 健康检查: https://ai.xingyuncl.com/health"
echo "📋 查看日志: pm2 logs"
