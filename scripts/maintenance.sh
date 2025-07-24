#!/bin/bash

echo "=== AI平台系统维护脚本 ==="
echo "开始时间: $(date)"
echo ""

# 1. 清理过期的Redis缓存
echo "1. 清理Redis缓存..."
redis-cli FLUSHDB
echo "✓ Redis缓存已清理"
echo ""

# 2. 优化数据库表
echo "2. 优化数据库表..."
mysql -u root -pqazQ1233210 ai_platform -e "
OPTIMIZE TABLE messages;
OPTIMIZE TABLE conversations;
OPTIMIZE TABLE user_activities;
OPTIMIZE TABLE billing_logs;
OPTIMIZE TABLE credit_transactions;
OPTIMIZE TABLE files;
" 2>/dev/null
echo "✓ 数据库表已优化"
echo ""

# 3. 清理旧日志
echo "3. 清理旧日志（30天前）..."
find /var/www/ai-platform/logs -name "*.log" -mtime +30 -delete 2>/dev/null
echo "✓ 旧日志已清理"
echo ""

# 4. 检查磁盘空间
echo "4. 磁盘空间检查..."
df -h | grep -E "/$|/var"
echo ""

# 5. 重启服务
echo "5. 重启服务..."
pm2 restart all
echo "✓ 服务已重启"
echo ""

echo "维护完成！"
echo "结束时间: $(date)"
