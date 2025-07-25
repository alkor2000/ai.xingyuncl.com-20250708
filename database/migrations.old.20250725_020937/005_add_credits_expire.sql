-- 添加积分有效期字段
ALTER TABLE users ADD COLUMN credits_expire_at TIMESTAMP NULL DEFAULT NULL COMMENT '积分过期时间' AFTER used_credits;

-- 为现有用户设置默认过期时间（365天后）
UPDATE users SET credits_expire_at = DATE_ADD(NOW(), INTERVAL 365 DAY) WHERE credits_expire_at IS NULL AND credits_quota > 0;

-- 添加索引以优化查询
ALTER TABLE users ADD INDEX idx_credits_expire (credits_expire_at);
