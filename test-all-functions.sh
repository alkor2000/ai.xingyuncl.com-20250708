#!/bin/bash

# AI Platform 完整功能测试脚本
# 测试前后端所有核心功能

echo "🚀 AI Platform 完整功能测试开始"
echo "======================================="

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试结果记录函数
test_result() {
    local result_code=\$1
    local test_name="\$2"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if [ $result_code -eq 0 ]; then
        echo -e "${GREEN}✅ $test_name${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}❌ $test_name${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

echo ""
echo -e "${BLUE}📋 1. 系统基础检查${NC}"
echo "-------------------"

# 检查PM2服务状态
pm2 list | grep -q "ai-platform-auth.*online"
test_result $? "后端服务运行状态"

pm2 list | grep -q "ai-platform-frontend.*online"
test_result $? "前端服务运行状态"

# 检查端口监听
netstat -tlnp | grep -q ":4000.*LISTEN"
test_result $? "后端端口4000监听"

netstat -tlnp | grep -q ":3000.*LISTEN"
test_result $? "前端端口3000监听"

# 检查数据库连接
mysql -u ai_user -p'AiPlatform@2025!' -e "SELECT 1;" ai_platform >/dev/null 2>&1
test_result $? "数据库连接"

echo ""
echo -e "${BLUE}📋 2. 基础API测试${NC}"
echo "-------------------"

# 健康检查
HEALTH_RESPONSE=$(curl -s https://ai.xingyuncl.com/health)
echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'
test_result $? "系统健康检查"

# 前端页面访问
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://ai.xingyuncl.com/)
if [ "$HTTP_CODE" = "200" ]; then
    test_result 0 "前端页面访问"
else
    test_result 1 "前端页面访问"
fi

echo ""
echo -e "${BLUE}📋 3. 用户认证功能测试${NC}"
echo "-------------------------"

# 用户登录测试
LOGIN_RESPONSE=$(curl -s -X POST https://ai.xingyuncl.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ai.xingyuncl.com","password":"admin123"}')

echo "$LOGIN_RESPONSE" | grep -q '"success":true'
test_result $? "管理员登录"

# 提取Token
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)

# 检查Token格式
if [ ${#ACCESS_TOKEN} -gt 100 ] && [ ${#REFRESH_TOKEN} -gt 50 ]; then
    test_result 0 "Token格式验证"
else
    test_result 1 "Token格式验证"
fi

# 检查Token有效期
echo "$LOGIN_RESPONSE" | grep -q '"expiresIn":"12h"'
test_result $? "Token有效期配置(12小时)"

# 获取用户信息
USER_INFO_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/auth/me)

echo "$USER_INFO_RESPONSE" | grep -q '"success":true'
test_result $? "获取用户信息"

echo "$USER_INFO_RESPONSE" | grep -q '"role":"super_admin"'
test_result $? "用户权限验证"

# Token刷新测试
REFRESH_RESPONSE=$(curl -s -X POST https://ai.xingyuncl.com/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")

echo "$REFRESH_RESPONSE" | grep -q '"success":true'
test_result $? "Token自动刷新"

# 更新ACCESS_TOKEN为刷新后的Token
NEW_ACCESS_TOKEN=$(echo "$REFRESH_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
if [ -n "$NEW_ACCESS_TOKEN" ]; then
    ACCESS_TOKEN="$NEW_ACCESS_TOKEN"
fi

echo ""
echo -e "${BLUE}📋 4. AI对话功能测试${NC}"
echo "---------------------"

# 获取会话列表
CONVERSATIONS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/chat/conversations)

echo "$CONVERSATIONS_RESPONSE" | grep -q '"success":true'
test_result $? "获取对话列表"

# 获取AI模型列表
MODELS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/chat/models)

echo "$MODELS_RESPONSE" | grep -q '"success":true'
test_result $? "获取AI模型列表"

# 创建新会话
CREATE_CONV_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试会话","model_name":"openai/gpt-4.1-mini"}' \
  https://ai.xingyuncl.com/api/chat/conversations)

echo "$CREATE_CONV_RESPONSE" | grep -q '"success":true'
test_result $? "创建新对话会话"

# 提取会话ID
CONVERSATION_ID=$(echo "$CREATE_CONV_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$CONVERSATION_ID" ]; then
    # 发送测试消息
    SEND_MESSAGE_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"content":"你好，这是一个测试消息"}' \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONVERSATION_ID/messages")

    echo "$SEND_MESSAGE_RESPONSE" | grep -q '"success":true'
    test_result $? "发送AI对话消息"

    echo "$SEND_MESSAGE_RESPONSE" | grep -q '"role":"assistant"'
    test_result $? "接收AI回复"

    # 获取会话消息列表
    MESSAGES_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONVERSATION_ID/messages")

    echo "$MESSAGES_RESPONSE" | grep -q '"success":true'
    test_result $? "获取对话消息列表"

    # 删除测试会话
    DELETE_CONV_RESPONSE=$(curl -s -X DELETE -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONVERSATION_ID")

    echo "$DELETE_CONV_RESPONSE" | grep -q '"success":true'
    test_result $? "删除对话会话"
else
    test_result 1 "发送AI对话消息"
    test_result 1 "接收AI回复"
    test_result 1 "获取对话消息列表"
    test_result 1 "删除对话会话"
fi

echo ""
echo -e "${BLUE}📋 5. 管理员功能测试${NC}"
echo "---------------------"

# 获取用户列表
USERS_LIST_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/admin/users)

echo "$USERS_LIST_RESPONSE" | grep -q '"success":true'
test_result $? "获取用户管理列表"

# 获取系统统计
STATS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/admin/stats)

echo "$STATS_RESPONSE" | grep -q '"success":true'
test_result $? "获取系统统计数据"

# 获取AI模型管理列表
ADMIN_MODELS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/admin/ai-models)

echo "$ADMIN_MODELS_RESPONSE" | grep -q '"success":true'
test_result $? "AI模型管理"

echo ""
echo -e "${BLUE}📋 6. 数据库完整性测试${NC}"
echo "-------------------------"

# 检查核心数据表
mysql -u ai_user -p'AiPlatform@2025!' ai_platform -e "SELECT COUNT(*) FROM users;" >/dev/null 2>&1
test_result $? "用户表数据"

mysql -u ai_user -p'AiPlatform@2025!' ai_platform -e "SELECT COUNT(*) FROM conversations;" >/dev/null 2>&1
test_result $? "对话表数据"

mysql -u ai_user -p'AiPlatform@2025!' ai_platform -e "SELECT COUNT(*) FROM messages;" >/dev/null 2>&1
test_result $? "消息表数据"

mysql -u ai_user -p'AiPlatform@2025!' ai_platform -e "SELECT COUNT(*) FROM ai_models;" >/dev/null 2>&1
test_result $? "AI模型表数据"

mysql -u ai_user -p'AiPlatform@2025!' ai_platform -e "SELECT COUNT(*) FROM permissions;" >/dev/null 2>&1
test_result $? "权限表数据"

echo ""
echo -e "${BLUE}📋 7. 性能和稳定性测试${NC}"
echo "---------------------------"

# 检查服务内存使用
AI_AUTH_MEM=$(pm2 list | grep "ai-platform-auth" | awk '{print \$9}' | grep -o '[0-9.]*')
if [ -n "$AI_AUTH_MEM" ] && [ $(echo "$AI_AUTH_MEM < 200" | bc -l) -eq 1 ]; then
    test_result 0 "后端内存使用正常(<200MB)"
else
    test_result 1 "后端内存使用正常(<200MB)"
fi

AI_FRONTEND_MEM=$(pm2 list | grep "ai-platform-frontend" | awk '{print \$9}' | grep -o '[0-9.]*')
if [ -n "$AI_FRONTEND_MEM" ] && [ $(echo "$AI_FRONTEND_MEM < 100" | bc -l) -eq 1 ]; then
    test_result 0 "前端内存使用正常(<100MB)"
else
    test_result 1 "前端内存使用正常(<100MB)"
fi

# 响应时间测试
RESPONSE_TIME=$(curl -o /dev/null -s -w "%{time_total}" https://ai.xingyuncl.com/api/auth/me \
  -H "Authorization: Bearer $ACCESS_TOKEN")

# 检查响应时间是否小于2秒
if [ -n "$RESPONSE_TIME" ] && [ $(echo "$RESPONSE_TIME < 2.0" | bc -l) -eq 1 ]; then
    test_result 0 "API响应时间正常(<2秒)"
else
    test_result 1 "API响应时间正常(<2秒)"
fi

# 用户登出测试
LOGOUT_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://ai.xingyuncl.com/api/auth/logout)

echo "$LOGOUT_RESPONSE" | grep -q '"success":true'
test_result $? "用户正常登出"

echo ""
echo "======================================="
echo -e "${YELLOW}📊 测试结果统计${NC}"
echo "======================================="
echo -e "总测试项目: ${BLUE}$TOTAL_TESTS${NC}"
echo -e "通过测试: ${GREEN}$PASSED_TESTS${NC}"
echo -e "失败测试: ${RED}$FAILED_TESTS${NC}"

# 计算通过率
if [ $TOTAL_TESTS -gt 0 ]; then
    PASS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    echo -e "通过率: ${YELLOW}$PASS_RATE%${NC}"
fi

echo ""
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}🎉 所有测试通过！AI Platform 功能完整！${NC}"
    exit 0
elif [ $PASS_RATE -ge 90 ]; then
    echo -e "${YELLOW}⚠️  大部分功能正常，有少量问题需要关注${NC}"
    exit 1
else
    echo -e "${RED}❌ 存在较多问题，请检查系统配置${NC}"
    exit 2
fi
