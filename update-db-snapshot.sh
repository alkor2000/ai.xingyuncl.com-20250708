#!/bin/bash
# 数据库口令从环境变量读取，不再写死在脚本里（例：set -a; source backend/.env; set +a）
: "${MYSQL_ROOT_PASSWORD:?请先设置环境变量 MYSQL_ROOT_PASSWORD}"


echo "========================================="
echo "正在导出数据库快照..."
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================="

# 导出数据库
mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction \
  --routines \
  --triggers \
  --complete-insert \
  --skip-extended-insert \
  --default-character-set=utf8mb4 \
  ai_platform > /var/www/ai-platform/docker/mysql-init/01-complete-database.sql

# 显示结果
if [ $? -eq 0 ]; then
    echo "✓ 导出成功！"
    ls -lh /var/www/ai-platform/docker/mysql-init/01-complete-database.sql
    echo ""
    echo "数据统计："
    echo "- 用户数: $(grep -c "INSERT INTO \`users\`" /var/www/ai-platform/docker/mysql-init/01-complete-database.sql)"
    echo "- 对话数: $(grep -c "INSERT INTO \`conversations\`" /var/www/ai-platform/docker/mysql-init/01-complete-database.sql)"
    echo "- 消息数: $(grep -c "INSERT INTO \`messages\`" /var/www/ai-platform/docker/mysql-init/01-complete-database.sql)"
else
    echo "✗ 导出失败！"
fi
