#!/bin/bash
# 部署前检查脚本

echo "=== AI平台部署前检查 ==="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查必要文件
echo "检查必要文件..."
files_to_check=(
    "docker-compose.yml"
    "docker/Dockerfile.backend"
    "docker/Dockerfile.frontend"
    "docker/nginx/default.conf"
    "docker/scripts/run-migrations.sh"
)

for file in "${files_to_check[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file"
    else
        echo -e "${RED}✗${NC} $file 缺失！"
    fi
done

# 检查目录
echo -e "\n检查必要目录..."
dirs_to_check=(
    "backend/src"
    "frontend/src"
    "database/migrations"
    "docker/mysql-init"
)

for dir in "${dirs_to_check[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓${NC} $dir"
    else
        echo -e "${RED}✗${NC} $dir 缺失！"
    fi
done

# 检查nginx配置占位符
echo -e "\n检查nginx配置..."
if grep -q "YOUR_DOMAIN_HERE" docker/nginx/default.conf; then
    echo -e "${YELLOW}!${NC} nginx配置包含占位符，部署时需要替换"
else
    echo -e "${GREEN}✓${NC} nginx配置已定制"
fi

# 列出迁移文件
echo -e "\n数据库迁移文件："
ls -1 database/migrations/*.sql 2>/dev/null | grep -v backup | sort

echo -e "\n${GREEN}检查完成！${NC}"
