-- 064: 验证已删除用户不出现在统计中

-- 1. 验证用户总数（应该只有39个活跃用户）
SELECT 
  '用户统计验证' as test_name,
  COUNT(*) as total_with_deleted,
  SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active_only
FROM users;

-- 2. 验证组统计（应该只统计未删除用户）
SELECT 
  '组统计验证' as test_name,
  g.name as group_name,
  COUNT(u.id) as user_count_all,
  SUM(CASE WHEN u.deleted_at IS NULL THEN 1 ELSE 0 END) as user_count_active_only
FROM user_groups g
LEFT JOIN users u ON g.id = u.group_id
GROUP BY g.id, g.name
LIMIT 5;

-- 3. 验证分组用户数（getGroupUserCount）
SELECT 
  '分组用户数验证' as test_name,
  group_id,
  COUNT(*) as count_with_status_check,
  SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as count_with_deleted_check
FROM users 
WHERE status != 'deleted'
GROUP BY group_id
LIMIT 5;
