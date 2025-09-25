#!/bin/bash

echo "=== 验证存储路径修复 ==="
echo ""

# 1. 检查配置文件是否正确
echo "1. 检查配置文件..."
if grep -q "getStorageRoot" /var/www/ai-platform/backend/src/config/index.js; then
    echo "✓ config/index.js 已更新"
else
    echo "✗ config/index.js 未正确更新"
fi

# 2. 检查StorageController是否还有硬编码
echo ""
echo "2. 检查硬编码路径..."
if grep -q "/var/www/ai-platform" /var/www/ai-platform/backend/src/controllers/StorageController.js; then
    echo "✗ StorageController.js 仍包含硬编码路径"
    grep "/var/www/ai-platform" /var/www/ai-platform/backend/src/controllers/StorageController.js
else
    echo "✓ StorageController.js 无硬编码路径"
fi

# 3. 检查环境变量配置文件
echo ""
echo "3. 检查Docker配置文件..."
if [ -f "/var/www/ai-platform/.env.docker.example" ]; then
    echo "✓ .env.docker.example 已创建"
fi
if [ -f "/var/www/ai-platform/.env.enterprise.template" ]; then
    echo "✓ .env.enterprise.template 已创建"
fi

# 4. 测试配置加载
echo ""
echo "4. 测试配置加载..."
cd /var/www/ai-platform/backend
node -e "
const config = require('./src/config');
console.log('Storage Root:', config.storage.root);
console.log('Temp Path:', config.storage.paths.temp);
console.log('Upload Path:', config.storage.paths.uploads);
"

echo ""
echo "=== 验证完成 ==="
