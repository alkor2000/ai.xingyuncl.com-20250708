-- 062: 为users表添加软删除支持
-- 用途：允许用户删除但保留所有关联数据，满足数据审计和恢复需求

-- 添加软删除时间戳字段
ALTER TABLE users 
  ADD COLUMN deleted_at TIMESTAMP NULL COMMENT '软删除时间（NULL=未删除）' AFTER updated_at;

-- 为软删除字段创建索引（提升查询性能）
CREATE INDEX idx_deleted_at ON users(deleted_at);

-- 说明：
-- 1. deleted_at IS NULL     → 正常用户
-- 2. deleted_at IS NOT NULL → 已删除用户
-- 3. 所有查询都需要添加 WHERE deleted_at IS NULL 过滤条件
-- 4. 删除操作：UPDATE users SET deleted_at = NOW() WHERE id = ?
-- 5. 恢复操作：UPDATE users SET deleted_at = NULL WHERE id = ?
