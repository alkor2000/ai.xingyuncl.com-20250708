-- =====================================================
-- Migration: 029_add_user_uuid_for_sso
-- Date: 2025-01-14
-- Description: 添加UUID字段支持SSO单点登录
-- =====================================================

-- 1. 添加uuid和uuid_source字段
ALTER TABLE users 
ADD COLUMN uuid VARCHAR(100) UNIQUE DEFAULT NULL COMMENT '用户唯一标识UUID' AFTER id,
ADD COLUMN uuid_source VARCHAR(20) DEFAULT 'system' COMMENT '标识来源：system/sso' AFTER uuid;

-- 2. 为现有用户生成UUID
UPDATE users 
SET uuid = UUID(), 
    uuid_source = 'system' 
WHERE uuid IS NULL;

-- 3. 设置uuid为非空
ALTER TABLE users MODIFY COLUMN uuid VARCHAR(100) UNIQUE NOT NULL;

-- 4. 添加索引提高查询性能
ALTER TABLE users ADD INDEX idx_uuid (uuid);
ALTER TABLE users ADD INDEX idx_uuid_source (uuid_source);

-- 5. 添加SSO配置到系统设置
INSERT INTO system_settings (setting_key, setting_value, setting_type, description)
VALUES (
  'sso_config',
  '{"enabled":false,"shared_secret":"","target_group_id":1,"default_credits":100,"signature_valid_minutes":5,"ip_whitelist_enabled":false,"allowed_ips":""}',
  'json',
  'SSO单点登录配置'
) ON DUPLICATE KEY UPDATE 
  description = 'SSO单点登录配置',
  updated_at = CURRENT_TIMESTAMP;

-- 记录迁移
INSERT IGNORE INTO schema_migrations (version, executed_at) 
VALUES ('029_add_user_uuid_for_sso', NOW());

-- 验证结果
SELECT 'SSO迁移完成' as status;
SELECT COUNT(*) as users_with_uuid FROM users WHERE uuid IS NOT NULL;
