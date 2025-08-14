#!/bin/bash

# 生成参数
USERNAME="sso_test_user_$(date +%s)"
TIMESTAMP=$(date +%s)
SECRET="ad22eb748e05fd6bf5ddf8c3f0813cb7"
SIGNATURE=$(echo -n "${USERNAME}${TIMESTAMP}${SECRET}" | sha256sum | cut -d' ' -f1)

echo "========== SSO测试 =========="
echo "用户名: $USERNAME"
echo "时间戳: $TIMESTAMP"
echo "密钥: $SECRET"
echo "签名: $SIGNATURE"
echo "=============================="

# 发送请求
curl -X POST https://ai.xingyuncl.com/api/auth/sso \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"timestamp\":$TIMESTAMP,\"signature\":\"$SIGNATURE\"}" \
  -v 2>&1 | grep -E "(< HTTP|< |{)"

