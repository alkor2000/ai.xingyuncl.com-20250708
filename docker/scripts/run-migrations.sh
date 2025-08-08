#!/bin/sh
set -e  # 任何命令失败时立即退出

echo "检查数据库迁移..."

# 等待数据库就绪
max_retries=30
retry_count=0
until nc -z ${DB_HOST} ${DB_PORT}; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -gt $max_retries ]; then
    echo "数据库连接超时，退出"
    exit 1
  fi
  echo "等待数据库... ($retry_count/$max_retries)"
  sleep 2
done

echo "数据库已就绪，等待2秒确保稳定..."
sleep 2

# MySQL连接参数
MYSQL_CMD="mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME}"

# 创建迁移跟踪表（保持向后兼容）
echo "创建迁移跟踪表..."
$MYSQL_CMD <<SQL 2>/dev/null || true
-- 创建schema_migrations表（主要使用）
CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(255) NOT NULL,
  executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
);

-- 创建migrations_history表（为了兼容）
CREATE TABLE IF NOT EXISTS migrations_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 同步两个表的数据
INSERT IGNORE INTO schema_migrations (version, executed_at)
SELECT migration_name, executed_at FROM migrations_history;
SQL

# 执行迁移文件
echo "开始检查迁移文件..."
migration_failed=0
for file in /app/database/migrations/*.sql; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    version="${filename%.sql}"
    
    # 跳过备份文件和非SQL文件
    if echo "$filename" | grep -q "backup\|\.bak\|~"; then
      continue
    fi
    
    # 检查是否已执行（同时检查两个表）
    executed=$($MYSQL_CMD -sN -e "
      SELECT COUNT(*) FROM (
        SELECT version FROM schema_migrations WHERE version='$version'
        UNION
        SELECT migration_name FROM migrations_history WHERE migration_name='$version'
      ) AS t
    " 2>/dev/null || echo "0")
    
    if [ "$executed" = "0" ]; then
      echo "执行迁移: $filename"
      
      # 执行迁移，如果失败记录错误但继续（某些迁移可能是幂等的）
      if $MYSQL_CMD < "$file" 2>/tmp/migration_error.log; then
        # 记录到两个表（保持兼容）
        $MYSQL_CMD -e "INSERT IGNORE INTO schema_migrations (version) VALUES ('$version')" 2>/dev/null
        $MYSQL_CMD -e "INSERT IGNORE INTO migrations_history (migration_name) VALUES ('$version')" 2>/dev/null
        echo "✓ 迁移 $filename 执行成功"
      else
        echo "⚠ 迁移 $filename 执行失败："
        cat /tmp/migration_error.log || echo "未知错误"
        migration_failed=1
      fi
    else
      echo "跳过已执行的迁移: $filename"
    fi
  fi
done

# 验证关键表是否存在
echo "验证数据库结构..."
tables=$($MYSQL_CMD -sN -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")
echo "数据库中共有 $tables 个表"

# 检查关键字段
echo "检查messages表status字段..."
has_status=$($MYSQL_CMD -sN -e "
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA='${DB_NAME}' 
  AND TABLE_NAME='messages' 
  AND COLUMN_NAME='status'
" 2>/dev/null || echo "0")

if [ "$has_status" = "1" ]; then
  echo "✓ messages表status字段存在"
else
  echo "⚠ messages表缺少status字段，尝试手动添加..."
  # 尝试添加status字段
  $MYSQL_CMD -e "ALTER TABLE messages ADD COLUMN IF NOT EXISTS status ENUM('pending', 'streaming', 'completed', 'failed') DEFAULT 'completed' AFTER model_name" 2>/dev/null || true
fi

if [ "$migration_failed" = "1" ]; then
  echo "⚠ 部分迁移失败，但继续启动服务"
fi

echo "数据库迁移检查完成"
