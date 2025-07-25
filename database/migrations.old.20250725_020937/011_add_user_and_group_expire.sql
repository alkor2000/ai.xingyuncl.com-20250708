-- 添加用户账号有效期和组有效期功能
-- 执行时间: 2025-07-23

-- 1. 给users表添加账号有效期字段
ALTER TABLE users 
ADD COLUMN expire_at TIMESTAMP NULL DEFAULT NULL COMMENT '账号有效期' AFTER credits_expire_at,
ADD INDEX idx_expire_at (expire_at);

-- 2. 给user_groups表添加组有效期字段
ALTER TABLE user_groups 
ADD COLUMN expire_date DATE NULL DEFAULT NULL COMMENT '组有效期（所有组员统一到期日期）' AFTER user_limit;

-- 3. 设置现有用户的默认有效期（1年后）
UPDATE users 
SET expire_at = DATE_ADD(NOW(), INTERVAL 1 YEAR) 
WHERE expire_at IS NULL AND role != 'super_admin';

-- 4. 设置现有组的默认有效期（1年后）
UPDATE user_groups 
SET expire_date = DATE_ADD(CURDATE(), INTERVAL 1 YEAR);

-- 5. 添加注释说明
ALTER TABLE users COMMENT = '用户表 - 包含账号有效期和积分有效期';
ALTER TABLE user_groups COMMENT = '用户分组表 - 包含组有效期设置';
