#!/bin/bash

echo "=== 检查数据分析功能所需的数据库表 ==="

mysql -u ai_user -p'AiPlatform@2025!' ai_platform -e "
-- 检查必要的表
SELECT 'credit_transactions' as table_name, COUNT(*) as exists_flag FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'credit_transactions'
UNION ALL
SELECT 'conversations', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'conversations'
UNION ALL
SELECT 'messages', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'messages'
UNION ALL
SELECT 'users', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'users'
UNION ALL
SELECT 'user_groups', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'user_groups'
UNION ALL
SELECT 'ai_models', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'ai_models'
UNION ALL
SELECT 'image_models', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'image_models'
UNION ALL
SELECT 'image_generations', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'image_generations'
UNION ALL
SELECT 'user_tags', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'user_tags'
UNION ALL
SELECT 'user_tag_relations', COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'ai_platform' AND table_name = 'user_tag_relations';
"

echo ""
echo "=== 检查后端依赖 ==="
cd /var/www/ai-platform/backend
npm list moment xlsx | grep -E "(moment|xlsx)"

echo ""
echo "=== 检查前端依赖 ==="
cd /var/www/ai-platform/frontend
npm list echarts echarts-for-react | grep -E "(echarts|echarts-for-react)"
