#!/bin/bash
# 生产服务器升级前检查脚本

echo "========================================"
echo "生产服务器数据库升级检查"
echo "========================================"

# 检查需要执行的迁移
docker exec ai-platform-mysql mysql -uroot -p${MYSQL_ROOT_PASSWORD:-rootpass2025} ai_platform << 'EOSQL'
-- 创建schema_migrations表（如果不存在）
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 检查已执行的迁移
SELECT 'Already executed migrations:' as Info;
SELECT version FROM schema_migrations ORDER BY version;

-- 检查需要执行的迁移
SELECT 'Checking migration 024 (message_sequence):' as Info;
SELECT COUNT(*) as has_sequence FROM information_schema.columns 
WHERE table_schema = 'ai_platform' 
AND table_name = 'messages' 
AND column_name = 'sequence_number';

SELECT 'Checking migration 025 (image_generation):' as Info;
SELECT COUNT(*) as has_image_tables FROM information_schema.tables 
WHERE table_schema = 'ai_platform' 
AND table_name = 'image_generations';

SELECT 'Checking migration 027 (document_upload):' as Info;
SELECT COUNT(*) as has_document_field FROM information_schema.columns 
WHERE table_schema = 'ai_platform' 
AND table_name = 'ai_models' 
AND column_name = 'document_upload_enabled';
EOSQL
