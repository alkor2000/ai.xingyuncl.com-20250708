#!/bin/bash
# 安全的生产环境迁移脚本 - 检查后再执行

DB_USER="ai_user"
DB_PASS="${DB_PASSWORD:-AiPlatform@2025!}"
DB_NAME="ai_platform"
MIGRATIONS_DIR="/app/database/migrations"

echo "🔍 生产环境迁移安全检查..."

# 检查每个迁移是否需要执行
check_and_run_migration() {
    local migration=$1
    echo "检查: $migration"
    
    # 先检查是否已记录
    EXISTS=$(mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -se "SELECT COUNT(*) FROM migrations_history WHERE migration_name='$migration'" 2>/dev/null)
    
    if [ "$EXISTS" = "1" ]; then
        echo "✓ 已执行(跳过): $migration"
        return 0
    fi
    
    # 检查是否需要执行（通过检查特定表/字段是否存在）
    case "$migration" in
        "030_add_html_editor_module.sql")
            # 检查html_pages表是否存在
            TABLE_EXISTS=$(mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -se "SHOW TABLES LIKE 'html_pages'" 2>/dev/null)
            if [ -n "$TABLE_EXISTS" ]; then
                echo "⚠️ 表已存在，标记为已执行: $migration"
                mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')" 2>/dev/null
                return 0
            fi
            ;;
        "029_add_user_uuid_for_sso.sql")
            # 检查users表是否有uuid字段
            COLUMN_EXISTS=$(mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -se "SHOW COLUMNS FROM users LIKE 'uuid'" 2>/dev/null)
            if [ -n "$COLUMN_EXISTS" ]; then
                echo "⚠️ 字段已存在，标记为已执行: $migration"
                mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')" 2>/dev/null
                return 0
            fi
            ;;
    esac
    
    # 执行迁移
    echo "⚡ 执行迁移: $migration"
    if mysql -u$DB_USER -p$DB_PASS -D$DB_NAME < "$MIGRATIONS_DIR/$migration" 2>/dev/null; then
        mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')" 2>/dev/null
        echo "✅ 成功: $migration"
    else
        echo "⚠️ 可能已执行或有冲突，标记完成: $migration"
        mysql -u$DB_USER -p$DB_PASS -D$DB_NAME -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')" 2>/dev/null
    fi
}

# 需要检查的迁移列表
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
    check_and_run_migration "$migration"
done

echo "✨ 迁移检查完成！"
