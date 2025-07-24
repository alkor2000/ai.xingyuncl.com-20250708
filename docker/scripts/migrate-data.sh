#!/bin/bash

# 数据迁移脚本
set -e

echo "📦 AI Platform 数据迁移脚本"
echo "============================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 导出当前数据库
echo -e "\n${GREEN}1. 导出当前数据库...${NC}"
mysqldump -h localhost -u ai_user -p'AiPlatform@2025!' ai_platform > /tmp/ai_platform_export.sql

echo -e "\n${GREEN}2. 压缩数据库文件...${NC}"
gzip /tmp/ai_platform_export.sql

echo -e "\n${GREEN}3. 打包上传文件...${NC}"
cd /var/www/ai-platform
tar -czf /tmp/uploads.tar.gz storage/uploads/

echo -e "\n${GREEN}✅ 数据导出完成！${NC}"
echo -e "数据库文件: /tmp/ai_platform_export.sql.gz"
echo -e "上传文件: /tmp/uploads.tar.gz"
echo -e "\n${YELLOW}请将这些文件传输到目标服务器${NC}"
