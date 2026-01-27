#!/bin/bash
set -e

echo "=========================================="
echo "星云AI平台 - 客户服务器初始化脚本"
echo "=========================================="

# 检查域名参数
if [ -z "$1" ]; then
    echo "错误：缺少域名参数"
    echo "用法: ./docker/scripts/init-customer.sh 客户域名.com"
    exit 1
fi

CUSTOMER_DOMAIN=$1
echo "客户域名: $CUSTOMER_DOMAIN"

# 检查是否已有.env文件
if [ -f ".env" ]; then
    echo "警告：.env文件已存在"
    read -p "是否覆盖？(yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "已取消"
        exit 0
    fi
fi

# 检查必要的命令
command -v openssl >/dev/null 2>&1 || { echo "错误：需要安装openssl"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "错误：需要安装node"; exit 1; }

# 生成密钥和密码
echo "正在生成安全密钥..."
MYSQL_ROOT_PASS=$(openssl rand -base64 32)
DB_PASS=$(openssl rand -base64 32)
JWT_ACCESS=$(node -e "console.log(require('crypto').randomBytes(64).toString('base64'))")
JWT_REFRESH=$(node -e "console.log(require('crypto').randomBytes(64).toString('base64'))")

# 创建.env文件
cat > .env << ENVEOF
# 自动生成时间: $(date)
# 客户域名: $CUSTOMER_DOMAIN

# 数据库配置
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASS
DB_PASSWORD=$DB_PASS
DB_NAME=ai_platform
DB_USER=ai_user

# JWT密钥配置
JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH

# 域名配置
CUSTOMER_DOMAIN=$CUSTOMER_DOMAIN
APP_DOMAIN=$CUSTOMER_DOMAIN
CORS_ORIGINS=https://$CUSTOMER_DOMAIN

# SSL证书路径
SSL_CERT_PATH=/etc/letsencrypt
ENVEOF

echo "✓ 环境变量配置完成"

# 创建必需目录
echo "创建必需目录..."
mkdir -p storage/uploads logs/backend certbot
echo "✓ 目录创建完成"

# 申请SSL证书
echo "正在申请SSL证书..."
if [ ! -d "/etc/letsencrypt/live/$CUSTOMER_DOMAIN" ]; then
    if command -v certbot >/dev/null 2>&1; then
        certbot certonly --standalone -d $CUSTOMER_DOMAIN --non-interactive --agree-tos --email admin@$CUSTOMER_DOMAIN
        echo "✓ SSL证书申请完成"
        
        # 配置 webroot 续期模式（避免80端口冲突）
        echo "配置SSL证书自动续期..."
        ACCOUNT_ID=$(grep "account" /etc/letsencrypt/renewal/$CUSTOMER_DOMAIN.conf | cut -d'=' -f2 | tr -d ' ')
        cat > /etc/letsencrypt/renewal/$CUSTOMER_DOMAIN.conf << CERTEOF
# renew_before_expiry = 30 days
version = 2.9.0
archive_dir = /etc/letsencrypt/archive/$CUSTOMER_DOMAIN
cert = /etc/letsencrypt/live/$CUSTOMER_DOMAIN/cert.pem
privkey = /etc/letsencrypt/live/$CUSTOMER_DOMAIN/privkey.pem
chain = /etc/letsencrypt/live/$CUSTOMER_DOMAIN/chain.pem
fullchain = /etc/letsencrypt/live/$CUSTOMER_DOMAIN/fullchain.pem

[renewalparams]
account = $ACCOUNT_ID
authenticator = webroot
server = https://acme-v02.api.letsencrypt.org/directory
key_type = ecdsa
webroot_path = /var/www/ai-platform/certbot

[[webroot_map]]
$CUSTOMER_DOMAIN = /var/www/ai-platform/certbot
CERTEOF
        echo "✓ SSL自动续期配置完成（webroot模式）"
    else
        echo "⚠ certbot未安装，请手动申请SSL证书"
        echo "  安装命令: apt-get install certbot"
        echo "  申请命令: certbot certonly --standalone -d $CUSTOMER_DOMAIN"
    fi
else
    echo "✓ SSL证书已存在"
fi

echo "=========================================="
echo "初始化完成！"
echo ""
echo "下一步执行："
echo "  docker-compose up -d"
echo ""
echo "⚠️ 重要：请保存以下密码到安全位置"
echo "数据库root密码: $MYSQL_ROOT_PASS"
echo "=========================================="
