#!/bin/bash
# 星云AI平台商用服务器升级脚本 - 2025年8月21日
# 目标服务器: www.nebulink.com.cn

echo "========================================"
echo "开始升级商用服务器..."
echo "========================================"

# 1. 进入项目目录
cd /var/www/ai-platform

# 2. 备份当前数据库
echo "备份数据库..."
docker-compose exec mysql mysqldump -uai_user -p'Nebu@Platform#2025' --no-tablespaces ai_platform > backup_$(date +%Y%m%d_%H%M%S).sql

# 3. 保存本地修改并拉取最新代码
echo "拉取最新代码..."
git stash
git pull origin main

# 4. 执行数据库升级（添加is_default字段）
echo "升级数据库结构..."
docker-compose exec mysql mysql -uai_user -p'Nebu@Platform#2025' ai_platform -e "
-- 检查并添加is_default字段
ALTER TABLE html_projects ADD COLUMN is_default TINYINT(1) DEFAULT 0 AFTER sort_order;
-- 设置默认项目
UPDATE html_projects SET is_default = 1 WHERE name = '默认项目';
"

# 5. 验证数据库升级
echo "验证数据库结构..."
docker-compose exec mysql mysql -uai_user -p'Nebu@Platform#2025' ai_platform -e "
SELECT COUNT(*) as '字段数' FROM information_schema.columns 
WHERE table_schema='ai_platform' AND table_name='html_projects';
"

# 6. 重建Docker镜像
echo "重建Docker镜像..."
docker-compose build

# 7. 重启服务
echo "重启服务..."
docker-compose down
docker-compose up -d

# 8. 查看服务状态
echo "检查服务状态..."
docker-compose ps

echo "========================================"
echo "升级完成！请进行功能测试"
echo "========================================"
