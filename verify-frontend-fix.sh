#!/bin/bash

echo "=== 验证前端文档上传功能修复 ==="
echo ""

# 1. 检查Settings.jsx是否包含document_upload_enabled
echo "1. 检查Settings.jsx中的handleEditModel函数："
if grep -q "document_upload_enabled" /var/www/ai-platform/frontend/src/pages/admin/Settings.jsx; then
    echo "   ✅ Settings.jsx包含document_upload_enabled处理"
    grep -A 2 "document_upload_enabled" /var/www/ai-platform/frontend/src/pages/admin/Settings.jsx | head -6
else
    echo "   ❌ Settings.jsx缺少document_upload_enabled处理"
fi
echo ""

# 2. 检查AIModelTable.jsx是否包含文档上传列
echo "2. 检查AIModelTable.jsx中的文档上传列："
if grep -q "table.documentUploadEnabled" /var/www/ai-platform/frontend/src/components/admin/settings/AIModelTable.jsx; then
    echo "   ✅ AIModelTable.jsx包含文档上传列"
else
    echo "   ❌ AIModelTable.jsx缺少文档上传列"
fi
echo ""

# 3. 检查AIModelFormModal.jsx是否包含文档上传表单项
echo "3. 检查AIModelFormModal.jsx中的文档上传表单项："
if grep -q "document_upload_enabled" /var/www/ai-platform/frontend/src/components/admin/settings/AIModelFormModal.jsx; then
    echo "   ✅ AIModelFormModal.jsx包含文档上传表单项"
else
    echo "   ❌ AIModelFormModal.jsx缺少文档上传表单项"
fi
echo ""

# 4. 检查i18n翻译文件
echo "4. 检查中文翻译文件："
if grep -q '"admin.models.table.documentUploadEnabled"' /var/www/ai-platform/frontend/src/locales/zh-CN/admin.json; then
    echo "   ✅ 中文翻译包含文档上传相关文本"
else
    echo "   ❌ 中文翻译缺少文档上传相关文本"
fi
echo ""

# 5. 检查前端构建是否最新
echo "5. 检查前端构建状态："
BUILD_TIME=$(stat -c %Y /var/www/ai-platform/frontend/dist/index.html 2>/dev/null || echo "0")
SOURCE_TIME=$(stat -c %Y /var/www/ai-platform/frontend/src/pages/admin/Settings.jsx)
CURRENT_TIME=$(date +%s)
BUILD_AGE=$((CURRENT_TIME - BUILD_TIME))

if [ "$BUILD_TIME" -gt "$SOURCE_TIME" ]; then
    echo "   ✅ 前端已重新构建（构建时间: $(date -d @$BUILD_TIME '+%Y-%m-%d %H:%M:%S')）"
else
    echo "   ⚠️  前端需要重新构建（上次构建: $BUILD_AGE 秒前）"
    echo "   请运行: cd /var/www/ai-platform/frontend && npm run build"
fi
echo ""

# 6. 检查PM2服务状态
echo "6. 检查PM2服务状态："
pm2 list | grep ai-platform-auth
echo ""

echo "=== 验证完成 ==="
echo ""
echo "下一步操作建议："
echo "1. 清除浏览器缓存（Ctrl+Shift+R 或 Cmd+Shift+R）"
echo "2. 访问 https://ai.xingyuncl.com"
echo "3. 登录管理员账号"
echo "4. 进入系统管理 > AI模型管理"
echo "5. 编辑任意模型，检查是否有'文档上传配置'选项"
echo "6. 切换文档上传开关并保存，验证功能是否正常"
