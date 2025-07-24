#!/bin/bash

# AI Platform Docker部署脚本
set -e

echo "🚀 AI Platform Docker部署脚本"
echo "================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查是否有.env文件
if [ ! -f .env ]; then
    echo -e "${YELLOW}未找到.env文件，从.env.example创建...${NC}"
    cp .env.example .env
    echo -e "${GREEN}请编辑.env文件配置您的环境变量${NC}"
    exit 1
fi

# 加载环境变量
source .env

# 部署函数
deploy() {
    echo -e "\n${GREEN}1. 构建Docker镜像...${NC}"
    docker-compose build --no-cache

    echo -e "\n${GREEN}2. 启动服务...${NC}"
    docker-compose up -d

    echo -e "\n${GREEN}3. 等待服务就绪...${NC}"
    sleep 10

    echo -e "\n${GREEN}4. 检查服务状态...${NC}"
    docker-compose ps

    echo -e "\n${GREEN}5. 初始化数据库...${NC}"
    # 等待MySQL完全启动
    until docker-compose exec mysql mysqladmin ping -h localhost --silent; do
        echo "等待MySQL启动..."
        sleep 5
    done

    echo -e "\n${GREEN}✅ 部署完成！${NC}"
    echo -e "前端访问地址: http://${APP_DOMAIN}"
    echo -e "后端API地址: http://${APP_DOMAIN}/api"
}

# 停止服务
stop() {
    echo -e "\n${YELLOW}停止所有服务...${NC}"
    docker-compose down
}

# 查看日志
logs() {
    docker-compose logs -f $1
}

# 备份数据
backup() {
    echo -e "\n${GREEN}备份数据...${NC}"
    mkdir -p backups
    
    # 备份数据库
    docker-compose exec mysql mysqldump -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} > backups/db_$(date +%Y%m%d_%H%M%S).sql
    
    # 备份上传文件
    tar -czf backups/uploads_$(date +%Y%m%d_%H%M%S).tar.gz storage/uploads/
    
    echo -e "${GREEN}备份完成！${NC}"
}

# 主菜单
case "$1" in
    deploy)
        deploy
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        deploy
        ;;
    logs)
        logs $2
        ;;
    backup)
        backup
        ;;
    *)
        echo "使用方法: $0 {deploy|stop|restart|logs|backup}"
        echo "  deploy  - 部署应用"
        echo "  stop    - 停止应用"
        echo "  restart - 重启应用"
        echo "  logs    - 查看日志 (logs [service])"
        echo "  backup  - 备份数据"
        exit 1
        ;;
esac
