#!/bin/bash
# 在生产服务器上运行此脚本检查需要执行的迁移

echo "检查生产服务器数据库状态..."
docker exec ai-platform-mysql mysql -uroot -p'rootpass2025' ai_platform -e "
-- 检查schema_migrations表
SELECT 'Current Migrations:' as Info;
SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;

-- 检查是否有document_upload_enabled字段
SELECT 'AI Models Structure:' as Info;
SHOW COLUMNS FROM ai_models LIKE '%document%';

-- 检查是否有image相关表
SELECT 'Image Tables:' as Info;
SHOW TABLES LIKE '%image%';
"
