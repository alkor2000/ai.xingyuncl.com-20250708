-- =====================================================
-- 日历权限系统集成
-- 版本: 1.0.0
-- 日期: 2025-10-10
-- 描述: 添加calendar.use权限并分配给所有活跃用户
-- =====================================================

-- 1. 为所有活跃用户添加日历使用权限
INSERT IGNORE INTO permissions (user_id, permission_type, created_at)
SELECT id, 'calendar.use', NOW()
FROM users
WHERE status = 'active';

-- 2. 查看权限分配情况
SELECT 
  p.permission_type,
  COUNT(DISTINCT p.user_id) as user_count,
  GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') as usernames
FROM permissions p
LEFT JOIN users u ON p.user_id = u.id
WHERE p.permission_type = 'calendar.use'
GROUP BY p.permission_type;

-- 3. 统计各权限的用户数
SELECT 
  permission_type,
  COUNT(*) as users
FROM permissions
GROUP BY permission_type
ORDER BY permission_type;

SELECT '✅ 日历权限添加完成' AS result;
