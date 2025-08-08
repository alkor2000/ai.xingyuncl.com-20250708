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

# MySQL连接参数（去掉ssl-mode参数，使用2>/dev/null抑制警告）
MYSQL_CMD="mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME}"

# 创建迁移表
echo "创建迁移跟踪表..."
$MYSQL_CMD <<EOF 2>/dev/null || true
CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(255) NOT NULL,
  executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
);
