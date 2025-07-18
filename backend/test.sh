#!/bin/bash

echo "🧪 运行后端测试..."
echo "===================="

# 设置颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 切换到后端目录
cd /var/www/ai-platform/backend

# 检查是否安装了依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}安装依赖...${NC}"
    npm install
fi

# 运行不同类型的测试
if [ "$1" = "unit" ]; then
    echo -e "${YELLOW}运行单元测试...${NC}"
    npm test -- --testPathPattern="unit"
elif [ "$1" = "integration" ]; then
    echo -e "${YELLOW}运行集成测试...${NC}"
    npm test -- --testPathPattern="integration"
elif [ "$1" = "coverage" ]; then
    echo -e "${YELLOW}运行测试并生成覆盖率报告...${NC}"
    npm test -- --coverage
elif [ "$1" = "watch" ]; then
    echo -e "${YELLOW}监视模式运行测试...${NC}"
    npm test -- --watch
else
    echo -e "${YELLOW}运行所有测试...${NC}"
    npm test
fi

# 检查测试结果
if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ 测试通过！${NC}"
else
    echo -e "\n${RED}❌ 测试失败！${NC}"
    exit 1
fi
