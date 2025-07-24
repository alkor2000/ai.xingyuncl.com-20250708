#!/bin/bash

echo "=== AI平台系统监控 ==="
echo "时间: $(date)"
echo "================================"
echo ""

# 1. 服务状态
echo "【服务状态】"
pm2 list
echo ""

# 2. 系统资源
echo "【系统资源】"
echo "CPU使用率:"
top -bn1 | grep "Cpu(s)" | awk '{print "  用户: "$2"%, 系统: "$4"%, 空闲: "$8"%"}'
echo ""
echo "内存使用:"
free -h | grep Mem | awk '{print "  总计: "$2", 已用: "$3", 可用: "$4", 使用率: "($3/$2)*100"%"}'
echo ""
echo "磁盘使用:"
df -h | grep -E "^/dev" | awk '{print "  "$6": "$5" ("$4" 可用)"}'
echo ""

# 3. 数据库状态
echo "【数据库状态】"
mysql -u root -pqazQ1233210 -e "
SELECT 
    'Active Connections' as Metric, 
    COUNT(*) as Value 
FROM information_schema.PROCESSLIST 
WHERE Command != 'Sleep'
UNION ALL
SELECT 
    'Total Connections' as Metric, 
    COUNT(*) as Value 
FROM information_schema.PROCESSLIST;
" ai_platform 2>/dev/null | grep -v "Warning"
echo ""

# 4. Redis状态
echo "【Redis状态】"
redis-cli INFO stats | grep -E "instantaneous_ops_per_sec|used_memory_human|connected_clients" | sed 's/:/ = /g'
echo ""

# 5. 今日统计
echo "【今日统计】"
mysql -u root -pqazQ1233210 -e "
SELECT 
    COUNT(DISTINCT user_id) as '活跃用户数',
    COUNT(*) as '消息总数',
    SUM(tokens) as 'Token消耗'
FROM messages 
WHERE DATE(created_at) = CURDATE();
" ai_platform 2>/dev/null | grep -v "Warning"
echo ""

# 6. API健康检查
echo "【API健康检查】"
curl -s http://localhost:4000/health | jq -r '"状态: " + .data.status'
echo ""

echo "================================"
echo "监控完成: $(date)"
