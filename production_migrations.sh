#!/bin/bash
# 生产服务器迁移执行脚本

echo "执行数据库迁移..."

# 执行每个迁移（会自动跳过已执行的）
for migration in 024_add_message_sequence 025_complete_image_generation_system 026_fix_image_cascade_delete 027_add_document_upload_to_ai_models; do
    echo "检查迁移: $migration"
    
    # 检查是否已执行
    EXISTS=$(docker exec ai-platform-mysql mysql -uroot -p${MYSQL_ROOT_PASSWORD:-rootpass2025} ai_platform -N -e "SELECT COUNT(*) FROM schema_migrations WHERE version = '$migration'")
    
    if [ "$EXISTS" -eq "0" ]; then
        echo "执行迁移: $migration"
        docker exec ai-platform-mysql mysql -uroot -p${MYSQL_ROOT_PASSWORD:-rootpass2025} ai_platform < /migrations/${migration}.sql
        
        # 记录迁移
        docker exec ai-platform-mysql mysql -uroot -p${MYSQL_ROOT_PASSWORD:-rootpass2025} ai_platform -e "INSERT INTO schema_migrations (version) VALUES ('$migration')"
        echo "✅ $migration 执行完成"
    else
        echo "⏭️  $migration 已执行，跳过"
    fi
done

echo "迁移完成！"
