#!/bin/bash

# 数据库连接信息
DB_USER="root"
DB_PASS="qazQ1233210"
DB_NAME="ai_platform"

echo "开始添加性能优化索引..."

# 创建索引的函数
create_index() {
    local table=$1
    local index_name=$2
    local columns=$3
    
    echo "正在为表 $table 创建索引 $index_name..."
    
    # 先尝试删除索引（忽略错误）
    mysql -u $DB_USER -p$DB_PASS $DB_NAME -e "DROP INDEX $index_name ON $table;" 2>/dev/null
    
    # 创建新索引
    mysql -u $DB_USER -p$DB_PASS $DB_NAME -e "CREATE INDEX $index_name ON $table($columns);"
    
    if [ $? -eq 0 ]; then
        echo "✓ 索引 $index_name 创建成功"
    else
        echo "✗ 索引 $index_name 创建失败（可能已存在）"
    fi
}

# messages表索引
create_index "messages" "idx_messages_conversation_created" "conversation_id, created_at DESC"
create_index "messages" "idx_messages_role" "role"
create_index "messages" "idx_messages_model_name" "model_name"

# conversations表索引
create_index "conversations" "idx_conversations_user_created" "user_id, created_at DESC"
create_index "conversations" "idx_conversations_user_priority" "user_id, priority DESC, created_at DESC"
create_index "conversations" "idx_conversations_cleared_at" "cleared_at"

# user_activities表索引
create_index "user_activities" "idx_user_activities_created" "created_at"
create_index "user_activities" "idx_user_activities_user_created" "user_id, created_at"

# billing_logs表索引
create_index "billing_logs" "idx_billing_logs_user_created" "user_id, created_at DESC"
create_index "billing_logs" "idx_billing_logs_model_created" "ai_model_id, created_at DESC"

# credit_transactions表索引
create_index "credit_transactions" "idx_credit_transactions_user_created" "user_id, created_at DESC"

# files表索引
create_index "files" "idx_files_user_created" "user_id, created_at DESC"

echo "索引创建完成！"

# 显示所有索引
echo ""
echo "当前数据库索引列表："
mysql -u $DB_USER -p$DB_PASS $DB_NAME -e "
SELECT 
    TABLE_NAME,
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
FROM 
    information_schema.STATISTICS 
WHERE 
    TABLE_SCHEMA = '$DB_NAME' 
    AND INDEX_NAME LIKE 'idx_%'
GROUP BY 
    TABLE_NAME, INDEX_NAME
ORDER BY 
    TABLE_NAME, INDEX_NAME;"
