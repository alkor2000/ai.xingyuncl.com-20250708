#!/bin/bash

# AI Platform 完整测试运行脚本

echo "🧪 AI Platform 自动化测试"
echo "=========================="

# 设置颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 测试结果统计
BACKEND_PASS=0
FRONTEND_PASS=0

# 运行后端测试
echo -e "\n${BLUE}📦 后端测试${NC}"
echo "-------------"
cd /var/www/ai-platform/backend

if npm test; then
    BACKEND_PASS=1
    echo -e "${GREEN}✅ 后端测试通过${NC}"
else
    echo -e "${RED}❌ 后端测试失败${NC}"
fi

# 运行前端测试
echo -e "\n${BLUE}📦 前端测试${NC}"
echo "-------------"
cd /var/www/ai-platform/frontend

if npm test -- --run; then
    FRONTEND_PASS=1
    echo -e "${GREEN}✅ 前端测试通过${NC}"
else
    echo -e "${RED}❌ 前端测试失败${NC}"
fi

# 生成测试报告
echo -e "\n${BLUE}📊 测试报告${NC}"
echo "-------------"

if [ $BACKEND_PASS -eq 1 ] && [ $FRONTEND_PASS -eq 1 ]; then
    echo -e "${GREEN}✅ 所有测试通过！${NC}"
    echo -e "\n测试覆盖率报告："
    echo "  - 后端: /var/www/ai-platform/backend/coverage/index.html"
    echo "  - 前端: /var/www/ai-platform/frontend/coverage/index.html"
    exit 0
else
    echo -e "${RED}❌ 部分测试失败，请检查错误日志${NC}"
    exit 1
fi
