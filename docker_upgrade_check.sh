#!/bin/bash
echo "====================================="
echo "🔍 Docker环境升级前检查"
echo "====================================="
echo ""

# 1. 检查当前运行状态
echo "1️⃣ 当前Docker服务状态："
docker-compose ps

echo ""
echo "2️⃣ 数据库表数量："
docker-compose exec mysql mysql -uai_user -p${DB_PASSWORD:-AiPlatform@2025!} -e "USE ai_platform; SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema='ai_platform';" 2>/dev/null

echo ""
echo "3️⃣ 已执行的迁移记录："
docker-compose exec mysql mysql -uai_user -p${DB_PASSWORD:-AiPlatform@2025!} -e "USE ai_platform; SELECT COUNT(*) as migration_count FROM migrations_history;" 2>/dev/null

echo ""
echo "4️⃣ 最近5条迁移记录："
docker-compose exec mysql mysql -uai_user -p${DB_PASSWORD:-AiPlatform@2025!} -e "USE ai_platform; SELECT * FROM migrations_history ORDER BY id DESC LIMIT 5;" 2>/dev/null

echo ""
echo "5️⃣ 检查重要表是否存在："
for table in users html_pages knowledge_modules credit_transactions; do
    EXISTS=$(docker-compose exec mysql mysql -uai_user -p${DB_PASSWORD:-AiPlatform@2025!} -se "USE ai_platform; SHOW TABLES LIKE '$table';" 2>/dev/null)
    if [ -n "$EXISTS" ]; then
        echo "   ✅ $table 表存在"
    else
        echo "   ❌ $table 表不存在"
    fi
done

echo ""
echo "====================================="
echo "✅ 检查完成，请记录以上信息"
echo "====================================="
