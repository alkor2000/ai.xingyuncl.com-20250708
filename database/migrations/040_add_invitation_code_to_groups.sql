-- 为用户组添加邀请码功能
-- 添加时间: 2025-01-09

-- 在user_groups表添加邀请码相关字段
ALTER TABLE user_groups 
  ADD COLUMN invitation_enabled TINYINT(1) DEFAULT 0 COMMENT '是否启用邀请码' AFTER site_logo,
  ADD COLUMN invitation_code VARCHAR(10) DEFAULT NULL COMMENT '邀请码（5位英文数字）' AFTER invitation_enabled,
  ADD COLUMN invitation_usage_count INT DEFAULT 0 COMMENT '邀请码使用次数' AFTER invitation_code,
  ADD COLUMN invitation_max_uses INT DEFAULT NULL COMMENT '邀请码最大使用次数（NULL表示无限制）' AFTER invitation_usage_count,
  ADD COLUMN invitation_expire_at TIMESTAMP NULL DEFAULT NULL COMMENT '邀请码过期时间' AFTER invitation_max_uses,
  ADD INDEX idx_invitation_code (invitation_code),
  ADD UNIQUE KEY uk_invitation_code (invitation_code);

-- 添加邀请码使用记录表（可选，用于追踪）
CREATE TABLE IF NOT EXISTS invitation_code_logs (
  id BIGINT NOT NULL AUTO_INCREMENT,
  group_id BIGINT NOT NULL,
  invitation_code VARCHAR(10) NOT NULL,
  user_id BIGINT NOT NULL,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  PRIMARY KEY (id),
  KEY idx_group_id (group_id),
  KEY idx_user_id (user_id),
  KEY idx_used_at (used_at),
  FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邀请码使用记录';

-- 记录迁移历史
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('040_add_invitation_code_to_groups.sql', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
