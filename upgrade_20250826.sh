#!/bin/bash
# 第四次快速升级 - 仅代码更新

cd /var/www/ai-platform

# 备份
echo "备份数据库..."
docker-compose exec mysql mysqldump -uai_user -p'Nebu@Platform#2025' --no-tablespaces ai_platform > backup_$(date +%Y%m%d_%H%M%S).sql

# 更新
echo "拉取代码..."
git pull origin main

# 构建
echo "重建镜像..."
docker-compose build frontend
docker-compose build backend

# 重启
echo "重启服务..."
docker-compose down
docker-compose up -d

# 验证
sleep 10
docker-compose ps
echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
