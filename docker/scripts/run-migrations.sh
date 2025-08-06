#!/bin/sh
set -e  # 任何命令失败时立即退出

echo "检查数据库迁移..."

# 等待数据库就绪
until nc -z ${DB_HOST} ${DB_PORT}; do
  echo "等待数据库..."
  sleep 1
done

echo "数据库已就绪，等待2秒确保稳定..."
sleep 2

# MySQL连接参数（添加--ssl-mode=DISABLED避免SSL警告）
MYSQL_CMD="mysql --ssl-mode=DISABLED -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME}"

# 创建迁移表
echo "创建迁移跟踪表..."
$MYSQL_CMD -e "
CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(255) NOT NULL,
  executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
);" 2>&1 | grep -v "Warning: Using a password"

# 执行迁移文件
for file in /app/database/migrations/*.sql; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    version="${filename%.sql}"
    
    # 跳过备份文件和非SQL文件
    if echo "$filename" | grep -q "backup\|\.bak\|~"; then
      continue
    fi
    
    # 检查是否已执行
    executed=$($MYSQL_CMD -sN -e "SELECT COUNT(*) FROM schema_migrations WHERE version='$version'" 2>/dev/null || echo "0")
    
    if [ "$executed" = "0" ]; then
      echo "执行迁移: $filename"
      
      # 执行迁移并检查错误
      if $MYSQL_CMD < "$file" 2>&1 | grep -v "Warning: Using a password"; then
        # 记录成功的迁移
        $MYSQL_CMD -e "INSERT INTO schema_migrations (version) VALUES ('$version')" 2>&1 | grep -v "Warning: Using a password"
        echo "✓ 迁移 $filename 执行成功"
      else
        echo "✗ 迁移 $filename 执行失败！"
        exit 1
      fi
    else
      echo "跳过已执行的迁移: $filename"
    fi
  fi
done

echo "所有迁移执行完成"

# 验证关键表是否存在
echo "验证数据库结构..."
tables=$($MYSQL_CMD -sN -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null)
echo "数据库中共有 $tables 个表"

if [ "$tables" -lt "10" ]; then
  echo "警告：表数量可能不正确，请检查迁移是否成功"
fi

echo "数据库迁移检查完成"
