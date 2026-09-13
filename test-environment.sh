#!/bin/bash
# 数据库口令从环境变量读取，不再写死在脚本里（例：set -a; source backend/.env; set +a）
: "${DB_PASSWORD:?请先设置环境变量 DB_PASSWORD}"


echo "🚀 AI Platform Environment Test"
echo "================================"

echo ""
echo "📋 1. Testing System Services..."
echo "MySQL Status:"
systemctl is-active mysql
echo "Redis Status:"
systemctl is-active redis-server  
echo "Nginx Status:"
systemctl is-active nginx

echo ""
echo "🔗 2. Testing Database Connection..."
mysql -u ai_user -p"$DB_PASSWORD" -e "SELECT 'MySQL Connection OK' as status, NOW() as timestamp;"

echo ""
echo "💾 3. Testing Redis Connection..."
redis-cli ping

echo ""
echo "📁 4. Testing Directory Structure..."
if [ -d "/var/www/ai-platform" ]; then
    echo "✅ Project directory exists"
    ls -la /var/www/ai-platform/
else
    echo "❌ Project directory missing"
fi

echo ""
echo "⚙️ 5. Testing Configuration Files..."
if [ -f "/var/www/ai-platform/config/env/.env.production" ]; then
    echo "✅ Environment config exists"
else
    echo "❌ Environment config missing"
fi

if [ -f "/var/www/ai-platform/ecosystem.config.js" ]; then
    echo "✅ PM2 config exists"
else
    echo "❌ PM2 config missing"
fi

echo ""
echo "🌐 6. Testing Nginx Configuration..."
nginx -t

echo ""
echo "🔐 7. Testing SSL Certificate..."
if [ -f "/etc/letsencrypt/live/ai.xingyuncl.com/fullchain.pem" ]; then
    echo "✅ SSL certificate exists"
    openssl x509 -in /etc/letsencrypt/live/ai.xingyuncl.com/fullchain.pem -text -noout | grep "Not After"
else
    echo "❌ SSL certificate missing"
fi

echo ""
echo "📡 8. Testing Domain Resolution..."
ping -c 2 ai.xingyuncl.com

echo ""
echo "🏗️ 9. Testing Node.js Environment..."
echo "Node Version: $(node --version)"
echo "NPM Version: $(npm --version)"
echo "PM2 Version: $(pm2 --version)"

echo ""
echo "📊 10. Testing Ports (should show listening or not)..."
echo "Port 3000 (Main App):"
netstat -tlnp | grep :3000 || echo "Not listening (expected)"
echo "Port 4000 (Auth Service):"
netstat -tlnp | grep :4000 || echo "Not listening (expected)"
echo "Port 4001 (Chat Service):"
netstat -tlnp | grep :4001 || echo "Not listening (expected)"

echo ""
echo "📝 11. Testing File Permissions..."
echo "Project directory permissions:"
ls -ld /var/www/ai-platform/
echo "Upload directory permissions:"
ls -ld /var/www/ai-platform/uploads/
echo "Logs directory permissions:"
ls -ld /var/www/ai-platform/logs/

echo ""
echo "🧪 12. Creating Test File..."
echo "Hello AI Platform" > /var/www/ai-platform/test.txt
if [ -f "/var/www/ai-platform/test.txt" ]; then
    echo "✅ File write test passed"
    rm /var/www/ai-platform/test.txt
else
    echo "❌ File write test failed"
fi

echo ""
echo "================================"
echo "Environment Test Completed!"
echo "================================"
