#!/bin/sh
echo "检查数据库迁移..."

# 等待数据库就绪
until nc -z ${DB_HOST} ${DB_PORT}; do
  echo "等待数据库..."
  sleep 1
done
sleep 2

# 创建迁移表
mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" -e "
CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(255) NOT NULL,
  executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
);" 2>/dev/null

# 执行迁移文件
for file in /app/database/migrations/*.sql; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    version="${filename%.sql}"
    
    # 跳过备份文件
    if echo "$filename" | grep -q "backup"; then
      continue
    fi
    
    # 检查是否已执行
    executed=$(mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" -sN -e "SELECT COUNT(*) FROM schema_migrations WHERE version='$version'" 2>/dev/null || echo "0")
    
    if [ "$executed" = "0" ]; then
      echo "执行迁移: $filename"
      mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" < "$file"
      mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" -e "INSERT INTO schema_migrations (version) VALUES ('$version')"
    fi
  fi
done

echo "迁移完成"
