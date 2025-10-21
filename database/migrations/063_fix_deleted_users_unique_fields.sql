-- 063: 修复已删除用户的唯一字段冲突（自动重命名）
-- 用途：释放email/username/uuid，允许重新注册

-- 为已删除用户添加deleted_前缀，使用deleted_at时间戳确保唯一性
UPDATE users
SET 
  email = CONCAT('deleted_', UNIX_TIMESTAMP(deleted_at), '_', email),
  username = CONCAT('deleted_', UNIX_TIMESTAMP(deleted_at), '_', username),
  uuid = CONCAT('deleted_', UNIX_TIMESTAMP(deleted_at), '_', uuid),
  updated_at = NOW()
WHERE deleted_at IS NOT NULL
  AND email NOT LIKE 'deleted_%'
  AND username NOT LIKE 'deleted_%'
  AND uuid NOT LIKE 'deleted_%';

-- 验证修复结果
SELECT 
  COUNT(*) as fixed_users,
  '已删除用户唯一字段已重命名，可以重新注册' as status
FROM users 
WHERE deleted_at IS NOT NULL
  AND email LIKE 'deleted_%';
