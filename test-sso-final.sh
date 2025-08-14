#!/bin/bash

# 生成参数
UUID="sso_test_user_$(date +%s)"
NAME="测试用户_$(date +%s)"
TIMESTAMP=$(date +%s)
SECRET="ad22eb748e05fd6bf5ddf8c3f0813cb7"

# 使用MD5生成签名（根据后端代码）
SIGNATURE=$(echo -n "${UUID}${TIMESTAMP}${SECRET}" | md5sum | cut -d' ' -f1)

echo "========== SSO测试（正确版本）=========="
echo "UUID: $UUID"
echo "名称: $NAME"
echo "时间戳: $TIMESTAMP"
echo "密钥: $SECRET"
echo "签名算法: MD5"
echo "签名: $SIGNATURE"
echo "========================================"
echo ""

# 构建JSON数据 - 使用正确的字段名
JSON_DATA="{\"uuid\":\"$UUID\",\"name\":\"$NAME\",\"timestamp\":$TIMESTAMP,\"signature\":\"$SIGNATURE\"}"
echo "请求数据: $JSON_DATA"
echo ""

# 发送请求
echo "发送请求到: https://ai.xingyuncl.com/api/auth/sso"
echo "响应结果:"
curl -X POST https://ai.xingyuncl.com/api/auth/sso \
  -H "Content-Type: application/json" \
  -d "$JSON_DATA" \
  -s | python3 -m json.tool

