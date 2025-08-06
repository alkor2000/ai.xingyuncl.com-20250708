#!/bin/bash

# ==================================================
# AI Platform 密钥生成脚本
# 用于生成安全的JWT密钥和其他密码
# ==================================================

echo "🔐 AI Platform 密钥生成工具"
echo "=================================="
echo ""

# 生成JWT密钥
generate_jwt_secret() {
    openssl rand -base64 64 | tr -d '\n'
}

# 生成强密码
generate_password() {
    openssl rand -base64 32 | tr -d '\n' | sed 's/[^a-zA-Z0-9]//g' | cut -c1-20
}

# 生成Redis密码
generate_redis_password() {
    openssl rand -hex 32
}

echo "# 生成的安全配置"
echo "# 请将这些值复制到您的 .env 文件"
echo ""
echo "# JWT密钥"
echo "JWT_ACCESS_SECRET=$(generate_jwt_secret)"
echo "JWT_REFRESH_SECRET=$(generate_jwt_secret)"
echo ""
echo "# 数据库密码建议"
echo "DB_PASSWORD=Ai@$(generate_password)2025"
echo ""
echo "# Redis密码建议"
echo "REDIS_PASSWORD=$(generate_redis_password)"
echo ""
echo "# MySQL Root密码建议"
echo "MYSQL_ROOT_PASSWORD=Root@$(generate_password)2025"
echo ""
echo "=================================="
echo "⚠️  请妥善保管这些密钥，不要提交到代码仓库"
echo "✅ 密钥生成完成"
