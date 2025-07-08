#!/bin/bash

echo "🏗️ Creating Modern Architecture Directory Structure..."

# 删除旧结构
rm -rf /var/www/ai-platform/apps /var/www/ai-platform/database /var/www/ai-platform/docs /var/www/ai-platform/infrastructure /var/www/ai-platform/logs /var/www/ai-platform/scripts /var/www/ai-platform/storage /var/www/ai-platform/tests /var/www/ai-platform/uploads 2>/dev/null || true

# 前端架构
mkdir -p /var/www/ai-platform/frontend/shell-app/{src,public,dist}
mkdir -p /var/www/ai-platform/frontend/modules/chat/{src,dist}
mkdir -p /var/www/ai-platform/frontend/modules/admin/{src,dist}
mkdir -p /var/www/ai-platform/frontend/modules/{draw,ppt,video,document,code}/{src,dist}
mkdir -p /var/www/ai-platform/frontend/shared/{ui-kit,utils,types,api,themes}/{src,dist}
mkdir -p /var/www/ai-platform/frontend/dist/{shell-app,modules,shared,assets}

# 后端架构
mkdir -p /var/www/ai-platform/backend/services/auth/{src,dist,tests,docs}
mkdir -p /var/www/ai-platform/backend/services/chat/{src,dist,tests}
mkdir -p /var/www/ai-platform/backend/services/file/{src,dist}
mkdir -p /var/www/ai-platform/backend/services/admin/{src,dist}
mkdir -p /var/www/ai-platform/backend/services/registry/{src,dist}
mkdir -p /var/www/ai-platform/backend/services/extensions/{draw,ppt,video,document,code}/src
mkdir -p /var/www/ai-platform/backend/shared/{database,middleware,utils,types}/{src,dist}
mkdir -p /var/www/ai-platform/backend/dist

# 数据存储
mkdir -p /var/www/ai-platform/database/{migrations,seeds,backups,scripts}
mkdir -p /var/www/ai-platform/storage/uploads/{avatars,documents,images,temp}
mkdir -p /var/www/ai-platform/storage/{cache,backups}

# 日志系统
mkdir -p /var/www/ai-platform/logs/frontend/{shell-app,modules}
mkdir -p /var/www/ai-platform/logs/backend/{auth,chat,file,admin,registry}
mkdir -p /var/www/ai-platform/logs/infrastructure/{nginx,pm2,mysql,redis}
mkdir -p /var/www/ai-platform/logs/monitoring

# 配置管理
mkdir -p /var/www/ai-platform/config/{environments,services,security}
mv /var/www/ai-platform/config/env/.env.production /var/www/ai-platform/config/environments/.env.production 2>/dev/null || true
rm -rf /var/www/ai-platform/config/env /var/www/ai-platform/config/nginx /var/www/ai-platform/config/pm2

# 部署运维
mkdir -p /var/www/ai-platform/deployment/{scripts,environments,nginx,pm2}
mkdir -p /var/www/ai-platform/operations/{backup,monitoring,maintenance}
mkdir -p /var/www/ai-platform/tools/{generators,scripts}

# 文档测试
mkdir -p /var/www/ai-platform/docs/{architecture,api,development,deployment}
mkdir -p /var/www/ai-platform/tests/{unit,integration,e2e,fixtures}

# 权限设置
chown -R root:www-data /var/www/ai-platform
chmod -R 755 /var/www/ai-platform
chmod -R 775 /var/www/ai-platform/storage /var/www/ai-platform/logs /var/www/ai-platform/database/backups
chmod 700 /var/www/ai-platform/config/environments

# 符号链接
ln -sf /var/www/ai-platform/storage/uploads /var/www/ai-platform/uploads
ln -sf /var/www/ai-platform/config/environments/.env.production /var/www/ai-platform/.env

# gitkeep文件
find /var/www/ai-platform -type d -empty -exec touch {}/.gitkeep \;

echo "✅ Directory structure created successfully!"
echo "📊 Total directories: $(find /var/www/ai-platform -type d | wc -l)"
echo "🔍 Verify with: tree -L 3 /var/www/ai-platform/"
