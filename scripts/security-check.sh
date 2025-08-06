#!/bin/bash

# ==================================================
# AI Platform 安全检查脚本
# ==================================================

echo "🔍 AI Platform 安全检查"
echo "=================================="
echo ""

ISSUES=0

# 检查是否使用默认JWT密钥
echo -n "检查JWT密钥配置... "
if [ -f /var/www/ai-platform/backend/.env ]; then
    if grep -q "your-super-secret-key-2025" /var/www/ai-platform/backend/.env; then
        echo "❌ 发现默认JWT密钥！"
        ISSUES=$((ISSUES + 1))
    else
        echo "✅ 已使用自定义密钥"
    fi
else
    echo "⚠️  未找到.env文件"
    ISSUES=$((ISSUES + 1))
fi

# 检查敏感备份文件（排除archive目录）
echo -n "检查敏感备份文件... "
BACKUP_COUNT=$(find /var/www/ai-platform -path /var/www/ai-platform/archive -prune -o -type f \( -name "*.bak*" -o -name "*.backup*" \) -print 2>/dev/null | wc -l)
if [ $BACKUP_COUNT -gt 0 ]; then
    echo "⚠️  发现 $BACKUP_COUNT 个备份文件"
    ISSUES=$((ISSUES + 1))
else
    echo "✅ 无敏感备份文件"
fi

# 检查文件权限
echo -n "检查.env文件权限... "
if [ -f /var/www/ai-platform/backend/.env ]; then
    PERM=$(stat -c %a /var/www/ai-platform/backend/.env)
    if [ "$PERM" != "600" ] && [ "$PERM" != "640" ]; then
        echo "⚠️  .env文件权限过于宽松 ($PERM)"
        ISSUES=$((ISSUES + 1))
    else
        echo "✅ 文件权限正确 ($PERM)"
    fi
fi

# 检查日志文件大小
echo -n "检查日志文件大小... "
LOG_SIZE=$(du -sh /var/www/ai-platform/logs 2>/dev/null | cut -f1)
echo "当前大小: $LOG_SIZE"

# 检查SSL证书
echo -n "检查SSL证书... "
if [ -f /etc/letsencrypt/live/ai.xingyuncl.com/cert.pem ]; then
    CERT_EXPIRY=$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/ai.xingyuncl.com/cert.pem | cut -d= -f2)
    echo "✅ 证书有效期至: $CERT_EXPIRY"
else
    echo "⚠️  未找到SSL证书"
fi

# 检查归档目录大小
echo -n "归档目录大小... "
if [ -d /var/www/ai-platform/archive ]; then
    ARCHIVE_SIZE=$(du -sh /var/www/ai-platform/archive 2>/dev/null | cut -f1)
    echo "$ARCHIVE_SIZE"
else
    echo "无归档目录"
fi

echo ""
echo "=================================="
if [ $ISSUES -eq 0 ]; then
    echo "✅ 安全检查通过！"
else
    echo "⚠️  发现 $ISSUES 个潜在问题，请及时处理"
fi
