-- 添加用户备注字段
-- 创建时间: 2025-01-17

-- 添加remark字段到users表
ALTER TABLE users ADD COLUMN remark TEXT DEFAULT NULL COMMENT '管理员备注' AFTER status;

-- 添加索引以优化搜索（如果需要按备注搜索）
ALTER TABLE users ADD FULLTEXT INDEX idx_remark (remark);

-- 提示信息
SELECT '用户备注字段添加完成！' AS message;
