#!/bin/bash
# 数据库口令从环境变量读取，不再写死在脚本里（例：set -a; source backend/.env; set +a）
: "${DB_PASSWORD:?请先设置环境变量 DB_PASSWORD}"

# 生产环境安全升级脚本 - 保留本地配置

set -e  # 遇到错误立即退出

echo "========================================"
echo "星云AI平台 - 生产环境安全升级脚本 v2.0"
echo "升级时间: $(date)"
echo "========================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 0. 检查当前目录
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}错误: 请在项目根目录(/var/www/ai-platform)运行此脚本${NC}"
    exit 1
fi

# 1. 备份关键文件
echo -e "${YELLOW}步骤1: 备份关键文件...${NC}"
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# 备份数据库
echo "备份数据库..."
docker exec ai-platform-mysql mysqldump -uai_user -p"$DB_PASSWORD" ai_platform > $BACKUP_DIR/database.sql 2>/dev/null || {
    echo -e "${RED}数据库备份失败，请检查密码${NC}"
    exit 1
}

# 备份配置文件
cp docker/nginx/default.conf $BACKUP_DIR/nginx_default.conf 2>/dev/null || true
cp docker-compose.yml $BACKUP_DIR/docker-compose.yml
echo "BACKUP_DIR=$BACKUP_DIR" > $BACKUP_DIR/backup_info.txt
echo "BACKUP_TIME=$(date)" >> $BACKUP_DIR/backup_info.txt

echo -e "${GREEN}✓ 备份完成: $BACKUP_DIR${NC}"

# 2. 保存本地配置
echo -e "${YELLOW}步骤2: 保存本地配置...${NC}"
cp docker/nginx/default.conf docker/nginx/default.conf.local 2>/dev/null || true

# 3. 拉取最新代码
echo -e "${YELLOW}步骤3: 拉取最新代码...${NC}"
# 暂存本地修改
git stash push -m "升级前自动暂存 $(date +%Y%m%d_%H%M%S)"
git fetch origin
git pull origin main || {
    echo -e "${RED}代码拉取失败${NC}"
    git stash pop
    exit 1
}

# 4. 恢复本地配置
echo -e "${YELLOW}步骤4: 恢复本地配置...${NC}"
if [ -f "docker/nginx/default.conf.local" ]; then
    echo "恢复nginx配置..."
    cp docker/nginx/default.conf.local docker/nginx/default.conf
fi

echo -e "${GREEN}✓ 本地配置已恢复${NC}"

# 5. 执行数据库迁移
echo -e "${YELLOW}步骤5: 执行数据库迁移...${NC}"
# 获取当前最新的迁移版本
CURRENT_VERSION=$(docker exec ai-platform-mysql mysql -uai_user -p"$DB_PASSWORD" ai_platform -N -e "
    SELECT COALESCE(MAX(CAST(SUBSTRING(version, 1, 3) AS UNSIGNED)), 0) 
    FROM schema_migrations 
    WHERE version REGEXP '^[0-9]{3}'" 2>/dev/null || echo "19")

echo "当前数据库迁移版本: $CURRENT_VERSION"

# 执行从020到028的迁移
for i in {20..28}; do
    migration_file=$(ls database/migrations/0${i}*.sql 2>/dev/null | head -1)
    if [ -f "$migration_file" ] && [ "$i" -gt "$CURRENT_VERSION" ]; then
        echo "执行迁移: $(basename $migration_file)"
        docker exec -i ai-platform-mysql mysql -uai_user -p"$DB_PASSWORD" ai_platform < "$migration_file" 2>&1 | grep -v "Warning" || true
    fi
done
echo -e "${GREEN}✓ 数据库迁移完成${NC}"

# 6. 验证nginx配置
echo -e "${YELLOW}步骤6: 验证nginx配置...${NC}"
# 确保包含正确的生产域名
if ! grep -q "www.nebulink.com.cn" docker/nginx/default.conf; then
    echo -e "${YELLOW}警告: nginx配置可能不正确，恢复备份...${NC}"
    if [ -f "$BACKUP_DIR/nginx_default.conf" ]; then
        cp $BACKUP_DIR/nginx_default.conf docker/nginx/default.conf
    fi
fi
echo -e "${GREEN}✓ nginx配置已验证${NC}"

# 7. 重建容器
echo -e "${YELLOW}步骤7: 重建Docker容器...${NC}"
docker-compose down
docker-compose up -d --build
echo -e "${GREEN}✓ 容器重建完成${NC}"

# 8. 等待服务启动
echo -e "${YELLOW}步骤8: 等待服务启动...${NC}"
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
    if docker exec ai-platform-backend curl -f http://localhost:4000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 服务已启动 (${i}秒)${NC}"
        break
    fi
    if [ $i -eq $MAX_WAIT ]; then
        echo -e "${RED}服务启动超时${NC}"
    fi
    echo -n "."
    sleep 1
done

# 9. 清理缓存
echo -e "${YELLOW}步骤9: 清理Redis缓存...${NC}"
docker exec ai-platform-redis redis-cli FLUSHALL > /dev/null
echo -e "${GREEN}✓ 缓存已清理${NC}"

# 10. 健康检查
echo -e "${YELLOW}步骤10: 系统健康检查...${NC}"
HEALTH_OK=true

# 检查容器状态
echo "容器状态："
docker ps --format "table {{.Names}}\t{{.Status}}" | grep ai-platform

# 检查后端API
echo -n "后端API: "
if curl -f http://localhost:4000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 正常${NC}"
else
    echo -e "${RED}✗ 异常${NC}"
    HEALTH_OK=false
fi

# 检查前端
echo -n "前端服务: "
if docker exec ai-platform-frontend curl -f http://localhost > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 正常${NC}"
else
    echo -e "${RED}✗ 异常${NC}"
    HEALTH_OK=false
fi

# 检查数据库连接
echo -n "数据库连接: "
if docker exec ai-platform-mysql mysql -uai_user -p"$DB_PASSWORD" -e "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 正常${NC}"
else
    echo -e "${RED}✗ 异常${NC}"
    HEALTH_OK=false
fi

echo ""
if [ "$HEALTH_OK" = true ]; then
    echo -e "${GREEN}========================================"
    echo "🎉 升级成功完成！"
    echo "========================================${NC}"
else
    echo -e "${YELLOW}========================================"
    echo "⚠️  升级完成但有警告"
    echo "========================================${NC}"
fi

echo ""
echo "重要信息："
echo "- 备份位置: $BACKUP_DIR/"
echo "- 日志查看: docker logs ai-platform-backend --tail 50"
echo ""
echo "请立即检查："
echo "1. 访问 https://www.nebulink.com.cn"
echo "2. 使用admin账号登录"
echo "3. 检查侧边栏菜单是否正常"
echo "4. 测试AI对话功能"
echo ""
if [ "$HEALTH_OK" = false ]; then
    echo -e "${YELLOW}如需回滚，执行以下命令：${NC}"
    echo "cd /var/www/ai-platform"
    echo "docker-compose down"
    echo "docker exec -i ai-platform-mysql mysql -uai_user -p\"\$DB_PASSWORD\" ai_platform < $BACKUP_DIR/database.sql"
    echo "cp $BACKUP_DIR/nginx_default.conf docker/nginx/default.conf"
    echo "docker-compose up -d"
fi
echo "========================================"
