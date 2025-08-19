#!/bin/sh
# Docker容器内的数据库升级脚本

echo "======================================"
echo "🔄 数据库智能升级"
echo "======================================"

# 等待MySQL服务就绪
echo "等待数据库服务..."
sleep 5

# 进入升级工具目录
cd /app/tools/database-upgrade

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    npm install --silent
fi

# 运行升级工具
DB_HOST=mysql \
DB_USER=$DB_USER \
DB_PASSWORD=$DB_PASSWORD \
DB_NAME=$DB_NAME \
node upgrade.js /app/database/schema/v1.2.0_complete.sql --dry-run

echo "======================================"
echo "✅ 升级分析完成"
echo "======================================"
