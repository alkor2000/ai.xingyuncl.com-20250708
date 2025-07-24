#!/bin/bash

# 配置
BACKUP_DIR="/var/www/ai-platform/backups/auto"
DB_USER="root"
DB_PASS="qazQ1233210"
DB_NAME="ai_platform"
KEEP_DAYS=7

echo "=== AI平台自动备份 ==="
echo "开始时间: $(date)"

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"
UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_backup_$TIMESTAMP.tar.gz"

# 1. 备份数据库
echo "1. 备份数据库..."
mysqldump -u $DB_USER -p$DB_PASS $DB_NAME > $DB_BACKUP_FILE 2>/dev/null
gzip $DB_BACKUP_FILE
echo "✓ 数据库已备份到: ${DB_BACKUP_FILE}.gz"

# 2. 备份上传文件
echo "2. 备份上传文件..."
tar -czf $UPLOADS_BACKUP_FILE -C /var/www/ai-platform storage/uploads 2>/dev/null
echo "✓ 上传文件已备份到: $UPLOADS_BACKUP_FILE"

# 3. 清理旧备份
echo "3. 清理${KEEP_DAYS}天前的备份..."
find $BACKUP_DIR -name "*.gz" -mtime +$KEEP_DAYS -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +$KEEP_DAYS -delete
echo "✓ 旧备份已清理"

# 4. 显示备份大小
echo ""
echo "备份文件大小:"
ls -lh $DB_BACKUP_FILE.gz $UPLOADS_BACKUP_FILE 2>/dev/null | awk '{print "  "$9": "$5}'

echo ""
echo "备份完成: $(date)"
