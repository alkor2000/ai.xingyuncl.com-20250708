#!/bin/bash
# 数据库口令从环境变量读取，不再写死在脚本里（例：set -a; source backend/.env; set +a）
: "${DB_PASSWORD:?请先设置环境变量 DB_PASSWORD}"

# 紧急Bug修复升级
echo "开始紧急升级 - $(date '+%Y-%m-%d %H:%M:%S')"
cd /var/www/ai-platform

# 快速备份
docker-compose exec mysql mysqldump -uai_user -p"$DB_PASSWORD" --no-tablespaces ai_platform > hotfix_backup_$(date +%Y%m%d_%H%M%S).sql

# 拉取修复
git pull origin main

# 只重建必要的镜像
docker-compose build frontend
docker-compose build backend

# 快速重启
docker-compose down
docker-compose up -d

echo "升级完成 - $(date '+%Y-%m-%d %H:%M:%S')"
docker-compose ps
