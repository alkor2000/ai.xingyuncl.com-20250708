#!/bin/bash
# 生产服务器迁移执行脚本 - 已更新至最新版本 (033)

echo "开始执行数据库迁移..."

# 定义所有需要按顺序执行的迁移脚本
# 将来每次升级，只需将新的文件名添加到这个列表末尾即可
MIGRATIONS=(
  "024_add_message_sequence"
  "025_complete_image_generation_system"
  "026_fix_image_cascade_delete"
  "027_add_document_upload_to_ai_models"
  "028_system_modules_production_fix"
  "029_add_user_uuid_for_sso"
  "030_add_html_editor_module"
  "031_fix_html_page_slugs"
  "032_add_html_editor_publish_credits"
  "033_add_html_transaction_types"
)

# 循环执行每个迁移
for migration in "${MIGRATIONS[@]}"; do
    echo "---"
    echo "正在检查迁移: $migration"
    
    # 检查是否已在数据库中记录过
    # 使用-s静默模式，仅输出结果
    EXISTS=$(docker exec ai-platform-mysql mysql -uai_user -p"$DB_PASSWORD" "$DB_NAME" -ss -e "SELECT COUNT(*) FROM migrations_history WHERE migration_name = '$migration'")
    
    if [ "$EXISTS" -eq "0" ]; then
        echo ">> 准备执行迁移: $migration.sql"
        # 从绑定卷执行SQL文件
        docker exec ai-platform-mysql mysql -uai_user -p"$DB_PASSWORD" "$DB_NAME" < "/var/www/ai-platform/database/migrations/${migration}.sql"
        
        # 检查上一个命令的退出码
        if [ $? -eq 0 ]; then
            # 成功后，将迁移记录到历史表
            docker exec ai-platform-mysql mysql -uai_user -p"$DB_PASSWORD" "$DB_NAME" -e "INSERT INTO migrations_history (migration_name) VALUES ('$migration')"
            echo "✅ 成功: $migration 已执行并记录。"
        else
            echo "❌ 失败: $migration 执行失败！请立即检查错误。"
            # 遇到错误立即退出，防止后续操作造成更大问题
            exit 1
        fi
    else
        echo "⏭️ 跳过: $migration 已执行过。"
    fi
done

echo "---"
echo "所有数据库迁移已完成！"
