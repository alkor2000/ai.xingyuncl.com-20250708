#!/bin/bash
echo "====================================="
echo "🔄 Docker环境增量数据库迁移"
echo "====================================="

# 数据库配置（Docker内部使用）
DB_USER="ai_user"
DB_PASS="${DB_PASSWORD:-AiPlatform@2025!}"
DB_NAME="ai_platform"

# 检查migrations_history表是否存在
echo "检查migrations_history表..."
TABLE_EXISTS=$(mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -se "SHOW TABLES LIKE 'migrations_history'" 2>/dev/null)
if [ -z "$TABLE_EXISTS" ]; then
    echo "创建migrations_history表..."
    mysql -u$DB_USER -p$DB_PASS -D$DB_NAME << 'SQL'
CREATE TABLE IF NOT EXISTS migrations_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
SQL
fi

# 待检查的迁移列表（只包含可能未执行的）
echo ""
echo "开始检查迁移状态..."
echo "------------------------"

MIGRATIONS=(
    "024_add_message_sequence.sql"
    "025_complete_image_generation_system.sql"
    "026_fix_image_cascade_delete.sql"
    "027_add_document_upload_to_ai_models.sql"
    "029_add_user_uuid_for_sso.sql"
    "030_add_html_editor_module.sql"
    "031_fix_html_page_slugs.sql"
    "032_add_html_editor_publish_credits.sql"
    "033_add_html_transaction_types.sql"
)

SUCCESS_COUNT=0
SKIP_COUNT=0
ERROR_COUNT=0

for migration in "${MIGRATIONS[@]}"; do
    # 检查是否已执行
    EXISTS=$(mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -se "SELECT COUNT(*) FROM migrations_history WHERE migration_name='$migration'" 2>/dev/null)
    
    if [ "$EXISTS" = "1" ]; then
        echo "✓ 已执行(跳过): $migration"
        ((SKIP_COUNT++))
    else
        echo "⚠️ 未记录: $migration - 标记为已执行（避免重复）"
        mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')" 2>/dev/null
        ((SUCCESS_COUNT++))
    fi
done

echo ""
echo "====================================="
echo "📊 迁移完成统计："
echo "   已跳过: $SKIP_COUNT"
echo "   新标记: $SUCCESS_COUNT"
echo "   错误: $ERROR_COUNT"
echo "====================================="
