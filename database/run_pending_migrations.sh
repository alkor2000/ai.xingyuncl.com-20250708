#!/bin/bash
# 运行待执行的数据库迁移脚本

DB_USER="ai_user"
DB_PASS="AiPlatform@2025!"
DB_NAME="ai_platform"
MIGRATIONS_DIR="/var/www/ai-platform/database/migrations"

echo "🔍 检查待执行的迁移..."

# 需要执行的迁移列表（按顺序）
MIGRATIONS=(
    "024_add_message_sequence.sql"
    "025_complete_image_generation_system.sql"
    "026_fix_image_cascade_delete.sql"
    "027_add_document_upload_to_ai_models.sql"
    "028_system_modules_production_fix.sql"
    "029_add_user_uuid_for_sso.sql"
    "030_add_html_editor_module.sql"
    "031_fix_html_page_slugs.sql"
    "032_add_html_editor_publish_credits.sql"
    "033_add_html_transaction_types.sql"
)

for migration in "${MIGRATIONS[@]}"; do
    echo "检查: $migration"
    
    # 检查是否已执行
    EXISTS=$(mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -se "SELECT COUNT(*) FROM migrations_history WHERE migration_name='$migration'" 2>/dev/null)
    
    if [ "$EXISTS" = "0" ]; then
        echo "⚡ 执行迁移: $migration"
        if mysql -u$DB_USER -p$DB_PASS -D$DB_NAME < "$MIGRATIONS_DIR/$migration" 2>/dev/null; then
            # 记录到migrations_history
            mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')" 2>/dev/null
            echo "✅ 成功: $migration"
        else
            echo "❌ 失败: $migration"
            exit 1
        fi
    else
        echo "✓ 已执行: $migration"
    fi
done

echo "✨ 所有迁移完成！"
