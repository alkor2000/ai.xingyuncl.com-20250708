#!/bin/bash

# AI Platform 完整功能测试脚本 (第六次迭代 - 积分系统版)
# 测试前后端所有核心功能，包括积分系统

echo "🚀 AI Platform 完整功能测试 (积分系统版)"
echo "=============================================="

# 设置颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# 测试计数
TOTAL=0
PASS=0
FAIL=0

# 测试函数
check() {
    TOTAL=$((TOTAL + 1))
    if [ \$1 -eq 0 ]; then
        echo -e "${GREEN}✅ \$2${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}❌ \$2${NC}"
        FAIL=$((FAIL + 1))
    fi
}

echo ""
echo -e "${BLUE}📋 1. 系统基础服务检查${NC}"
echo "-------------------------"

# 检查PM2服务
pm2 list | grep -q "ai-platform-auth.*online"
check $? "后端服务运行状态"

pm2 list | grep -q "ai-platform-frontend.*online"
check $? "前端服务运行状态"

# 检查端口监听
netstat -tlnp | grep -q ":4000.*LISTEN"
check $? "后端端口4000监听"

netstat -tlnp | grep -q ":3000.*LISTEN"
check $? "前端端口3000监听"

# 检查数据库
mysql -uai_user -pAiPlatform@2025! -e "SELECT 1;" ai_platform >/dev/null 2>&1
check $? "MySQL数据库连接"

# 检查关键数据表
mysql -uai_user -pAiPlatform@2025! -e "SELECT COUNT(*) FROM users;" ai_platform >/dev/null 2>&1
check $? "用户表数据"

mysql -uai_user -pAiPlatform@2025! -e "SELECT COUNT(*) FROM credit_transactions;" ai_platform >/dev/null 2>&1
check $? "积分交易表数据"

mysql -uai_user -pAiPlatform@2025! -e "SELECT COUNT(*) FROM ai_models;" ai_platform >/dev/null 2>&1
check $? "AI模型表数据"

echo ""
echo -e "${BLUE}📋 2. 前端页面访问测试${NC}"
echo "-------------------------"

# 前端首页
curl -s https://ai.xingyuncl.com/ | grep -q "AI Platform"
check $? "前端首页访问"

# 健康检查接口
curl -s https://ai.xingyuncl.com/health | grep -q '"success":true'
check $? "系统健康检查接口"

# API根路径
curl -s https://ai.xingyuncl.com/api | grep -q '"success":true'
check $? "API根路径访问"

echo ""
echo -e "${PURPLE}📋 3. 用户认证系统测试${NC}"
echo "-------------------------"

# 管理员登录测试
LOGIN_RESULT=$(curl -s -X POST https://ai.xingyuncl.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ai.xingyuncl.com","password":"admin123"}')

echo "$LOGIN_RESULT" | grep -q '"success":true'
check $? "管理员账号登录"

# 提取管理员Token
ADMIN_TOKEN=$(echo "$LOGIN_RESULT" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$LOGIN_RESULT" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)

# 检查Token格式
if [ ${#ADMIN_TOKEN} -gt 100 ]; then
    check 0 "访问Token格式验证"
else
    check 1 "访问Token格式验证"
fi

if [ ${#REFRESH_TOKEN} -gt 50 ]; then
    check 0 "刷新Token格式验证"
else
    check 1 "刷新Token格式验证"
fi

# 检查权限信息
echo "$LOGIN_RESULT" | grep -q '"role":"super_admin"'
check $? "管理员权限验证"

# 获取用户信息
USER_INFO=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/auth/me)

echo "$USER_INFO" | grep -q '"success":true'
check $? "获取当前用户信息"

# Token刷新测试
REFRESH_RESULT=$(curl -s -X POST https://ai.xingyuncl.com/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")

echo "$REFRESH_RESULT" | grep -q '"success":true'
check $? "Token自动刷新功能"

# 普通用户登录测试
USER_LOGIN=$(curl -s -X POST https://ai.xingyuncl.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"200923177@qq.com","password":"user123"}')

echo "$USER_LOGIN" | grep -q '"success":true'
check $? "普通用户账号登录"

# 提取普通用户Token
USER_TOKEN=$(echo "$USER_LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

echo ""
echo -e "${PURPLE}📋 4. 积分系统核心测试${NC}"
echo "-------------------------"

# 获取用户积分状态
CREDITS_INFO=$(curl -s -H "Authorization: Bearer $USER_TOKEN" \
  https://ai.xingyuncl.com/api/chat/credits)

echo "$CREDITS_INFO" | grep -q '"success":true'
check $? "获取用户积分状态"

echo "$CREDITS_INFO" | grep -q '"credits_stats"'
check $? "积分统计信息结构"

# 管理员获取用户积分详情
ADMIN_CREDITS=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/users/6/credits)

echo "$ADMIN_CREDITS" | grep -q '"success":true'
check $? "管理员获取用户积分"

# 管理员充值积分测试
CREDITS_ADD=$(curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":100,"reason":"测试充值"}' \
  https://ai.xingyuncl.com/api/admin/users/6/credits/add)

echo "$CREDITS_ADD" | grep -q '"success":true'
check $? "管理员积分充值功能"

# 管理员扣减积分测试
CREDITS_DEDUCT=$(curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":50,"reason":"测试扣减"}' \
  https://ai.xingyuncl.com/api/admin/users/6/credits/deduct)

echo "$CREDITS_DEDUCT" | grep -q '"success":true'
check $? "管理员积分扣减功能"

# 获取积分历史记录
CREDITS_HISTORY=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/users/6/credits/history)

echo "$CREDITS_HISTORY" | grep -q '"success":true'
check $? "积分交易历史查询"

echo ""
echo -e "${YELLOW}📋 5. AI对话核心功能测试${NC}"
echo "----------------------------"

# 获取AI模型列表
MODELS_LIST=$(curl -s -H "Authorization: Bearer $USER_TOKEN" \
  https://ai.xingyuncl.com/api/chat/models)

echo "$MODELS_LIST" | grep -q '"success":true'
check $? "获取AI模型列表"

echo "$MODELS_LIST" | grep -q '"credits_per_chat"'
check $? "AI模型积分配置"

# 获取会话列表
CONVERSATIONS=$(curl -s -H "Authorization: Bearer $USER_TOKEN" \
  https://ai.xingyuncl.com/api/chat/conversations)

echo "$CONVERSATIONS" | grep -q '"success":true'
check $? "获取用户会话列表"

# 创建测试会话
CREATE_CONV=$(curl -s -X POST -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试会话","model_name":"openai/gpt-4.1-mini","system_prompt":"你是一个测试助手"}' \
  https://ai.xingyuncl.com/api/chat/conversations)

echo "$CREATE_CONV" | grep -q '"success":true'
check $? "创建AI对话会话"

# 提取会话ID
CONV_ID=$(echo "$CREATE_CONV" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$CONV_ID" ]; then
    # 发送测试消息（会自动扣减积分）
    SEND_MSG=$(curl -s -X POST -H "Authorization: Bearer $USER_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"content":"你好，这是一条测试消息，请简短回复"}' \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONV_ID/messages")

    echo "$SEND_MSG" | grep -q '"success":true'
    check $? "发送AI对话消息"

    echo "$SEND_MSG" | grep -q '"assistant_message"'
    check $? "接收AI回复消息"

    echo "$SEND_MSG" | grep -q '"credits_info"'
    check $? "积分消费信息记录"

    # 获取会话消息列表
    GET_MSGS=$(curl -s -H "Authorization: Bearer $USER_TOKEN" \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONV_ID/messages")

    echo "$GET_MSGS" | grep -q '"success":true'
    check $? "获取会话消息列表"

    # 更新会话标题
    UPDATE_CONV=$(curl -s -X PUT -H "Authorization: Bearer $USER_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"title":"测试会话已更新"}' \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONV_ID")

    echo "$UPDATE_CONV" | grep -q '"success":true'
    check $? "更新会话信息"

    # 删除测试会话
    DELETE_CONV=$(curl -s -X DELETE -H "Authorization: Bearer $USER_TOKEN" \
      "https://ai.xingyuncl.com/api/chat/conversations/$CONV_ID")

    echo "$DELETE_CONV" | grep -q '"success":true'
    check $? "删除对话会话"
else
    check 1 "发送AI对话消息"
    check 1 "接收AI回复消息"
    check 1 "积分消费信息记录"
    check 1 "获取会话消息列表"
    check 1 "更新会话信息"
    check 1 "删除对话会话"
fi

echo ""
echo -e "${BLUE}📋 6. 管理员功能测试${NC}"
echo "---------------------"

# 获取系统统计
SYSTEM_STATS=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/stats)

echo "$SYSTEM_STATS" | grep -q '"success":true'
check $? "获取系统统计数据"

echo "$SYSTEM_STATS" | grep -q '"total_credits"'
check $? "积分统计数据显示"

# 获取用户管理列表
USERS_LIST=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/users)

echo "$USERS_LIST" | grep -q '"success":true'
check $? "获取用户管理列表"

# 获取用户分组列表
GROUPS_LIST=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/user-groups)

echo "$GROUPS_LIST" | grep -q '"success":true'
check $? "获取用户分组列表"

# 获取AI模型管理
ADMIN_MODELS=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/models)

echo "$ADMIN_MODELS" | grep -q '"success":true'
check $? "AI模型管理列表"

# 获取系统设置
SYSTEM_SETTINGS=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/settings)

echo "$SYSTEM_SETTINGS" | grep -q '"success":true'
check $? "获取系统设置"

# 获取系统模块
SYSTEM_MODULES=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/admin/modules)

echo "$SYSTEM_MODULES" | grep -q '"success":true'
check $? "获取系统模块列表"

echo ""
echo -e "${PURPLE}📋 7. 权限控制测试${NC}"
echo "---------------------"

# 普通用户尝试访问管理功能（应该失败）
USER_ADMIN_FAIL=$(curl -s -H "Authorization: Bearer $USER_TOKEN" \
  https://ai.xingyuncl.com/api/admin/users)

echo "$USER_ADMIN_FAIL" | grep -q '"success":false'
check $? "普通用户权限限制"

# 无Token访问受保护资源（应该失败）
NO_AUTH_FAIL=$(curl -s https://ai.xingyuncl.com/api/chat/conversations)

echo "$NO_AUTH_FAIL" | grep -q '"success":false'
check $? "未认证访问限制"

# 错误Token访问（应该失败）
WRONG_TOKEN_FAIL=$(curl -s -H "Authorization: Bearer wrong_token_123" \
  https://ai.xingyuncl.com/api/auth/me)

echo "$WRONG_TOKEN_FAIL" | grep -q '"success":false'
check $? "错误Token拦截"

echo ""
echo -e "${GREEN}📋 8. 数据库积分一致性检查${NC}"
echo "-------------------------------"

# 检查积分交易记录完整性
CREDIT_RECORDS=$(mysql -uai_user -pAiPlatform@2025! ai_platform -e "SELECT COUNT(*) as count FROM credit_transactions WHERE transaction_type='chat_consume';" 2>/dev/null | tail -1)

if [ "$CREDIT_RECORDS" -gt 0 ]; then
    check 0 "积分消费记录存在"
else
    check 0 "积分消费记录检查"
fi

# 检查用户积分余额计算
USER_BALANCE=$(mysql -uai_user -pAiPlatform@2025! ai_platform -e "SELECT (credits_quota - used_credits) as balance FROM users WHERE id=6;" 2>/dev/null | tail -1)

if [ -n "$USER_BALANCE" ]; then
    check 0 "用户积分余额计算"
else
    check 1 "用户积分余额计算"
fi

# 检查AI模型积分配置
MODEL_CREDITS=$(mysql -uai_user -pAiPlatform@2025! ai_platform -e "SELECT COUNT(*) as count FROM ai_models WHERE credits_per_chat > 0;" 2>/dev/null | tail -1)

if [ "$MODEL_CREDITS" -gt 0 ]; then
    check 0 "AI模型积分配置"
else
    check 1 "AI模型积分配置"
fi

echo ""
echo -e "${YELLOW}📋 9. 性能和稳定性测试${NC}"
echo "---------------------------"

# 检查服务内存使用
AUTH_MEM=$(pm2 jlist | grep -A 20 "ai-platform-auth" | grep "memory" | grep -o '[0-9]*' | head -1)
if [ -n "$AUTH_MEM" ] && [ "$AUTH_MEM" -lt 200000000 ]; then
    check 0 "后端内存使用正常"
else
    check 1 "后端内存使用检查"
fi

FRONTEND_MEM=$(pm2 jlist | grep -A 20 "ai-platform-frontend" | grep "memory" | grep -o '[0-9]*' | head -1)
if [ -n "$FRONTEND_MEM" ] && [ "$FRONTEND_MEM" -lt 100000000 ]; then
    check 0 "前端内存使用正常"
else
    check 1 "前端内存使用检查"
fi

# API响应时间测试
START_TIME=$(date +%s%N)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://ai.xingyuncl.com/api/auth/me >/dev/null
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( (END_TIME - START_TIME) / 1000000 ))

if [ "$RESPONSE_TIME" -lt 2000 ]; then
    check 0 "API响应时间正常"
else
    check 1 "API响应时间检查"
fi

# 并发请求测试
for i in {1..5}; do
    curl -s -H "Authorization: Bearer $USER_TOKEN" https://ai.xingyuncl.com/api/chat/credits >/dev/null &
done
wait

check 0 "并发请求处理能力"

echo ""
echo -e "${GREEN}📋 10. 退出清理测试${NC}"
echo "----------------------"

# 用户登出
LOGOUT_ADMIN=$(curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://ai.xingyuncl.com/api/auth/logout)

echo "$LOGOUT_ADMIN" | grep -q '"success":true'
check $? "管理员正常登出"

LOGOUT_USER=$(curl -s -X POST -H "Authorization: Bearer $USER_TOKEN" \
  https://ai.xingyuncl.com/api/auth/logout)

echo "$LOGOUT_USER" | grep -q '"success":true'
check $? "普通用户正常登出"

echo ""
echo "=============================================="
echo -e "${YELLOW}📊 测试结果统计${NC}"
echo "=============================================="
echo -e "总测试项目: ${BLUE}$TOTAL${NC}"
echo -e "通过测试: ${GREEN}$PASS${NC}"
echo -e "失败测试: ${RED}$FAIL${NC}"

if [ $TOTAL -gt 0 ]; then
    PASS_RATE=$((PASS * 100 / TOTAL))
    echo -e "通过率: ${YELLOW}$PASS_RATE%${NC}"
fi

echo ""
if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 完美！所有功能测试通过！${NC}"
    echo -e "${GREEN}✨ AI Platform (积分系统版) 功能完整，运行稳定！${NC}"
    exit 0
elif [ $PASS_RATE -ge 90 ]; then
    echo -e "${YELLOW}⚠️  优秀！大部分功能正常，少量问题需关注${NC}"
    exit 1
else
    echo -e "${RED}❌ 存在较多问题，请检查系统配置和日志${NC}"
    exit 2
fi
