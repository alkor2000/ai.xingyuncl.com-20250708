#!/bin/bash
DB_USER="ai_user"
DB_PASS="AiPlatform@2025!"
DB_NAME="ai_platform"

echo "🔧 修复migrations_history表记录..."

# 根据实际存在的表结构，标记已执行的迁移
EXECUTED_MIGRATIONS=(
    "014_create_api_services_tables.sql"
    "015_add_group_site_config.sql"
    "018_create_knowledge_modules.sql"
    "020_create_module_combination_items.sql"
    "021_add_knowledge_module_group_ids.sql"
    "023_add_message_status.sql"
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

for migration in "${EXECUTED_MIGRATIONS[@]}"; do
    echo "标记已执行: $migration"
    mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT IGNORE INTO migrations_history (migration_name, executed_at) VALUES ('$migration', NOW())" 2>/dev/null
done

echo "✅ migrations_history表修复完成"

# 显示当前状态
echo ""
echo "📊 当前迁移状态："
mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "SELECT * FROM migrations_history ORDER BY id DESC LIMIT 20"
