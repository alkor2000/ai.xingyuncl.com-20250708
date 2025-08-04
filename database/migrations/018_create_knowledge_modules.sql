-- 018_create_knowledge_modules.sql
-- 创建万智台知识模块相关表

-- 1. 创建知识模块表
CREATE TABLE IF NOT EXISTS `knowledge_modules` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL COMMENT '模块名称',
  `description` TEXT COMMENT '模块描述',
  `content` MEDIUMTEXT NOT NULL COMMENT '模块内容',
  `prompt_type` ENUM('system','normal') NOT NULL DEFAULT 'normal' COMMENT '提示词类型：system-系统级，normal-普通',
  `module_scope` ENUM('personal','team','system') NOT NULL DEFAULT 'personal' COMMENT '模块范围：personal-个人，team-团队，system-系统',
  `content_visible` BOOLEAN DEFAULT TRUE COMMENT '内容是否可见（仅对团队和系统模块有效）',
  `creator_id` BIGINT NOT NULL COMMENT '创建者ID',
  `group_id` BIGINT DEFAULT NULL COMMENT '团队模块所属的组ID',
  `category` VARCHAR(50) DEFAULT NULL COMMENT '分类',
  `tags` JSON DEFAULT NULL COMMENT '标签',
  `sort_order` INT DEFAULT 0 COMMENT '排序顺序',
  `is_active` BOOLEAN DEFAULT TRUE COMMENT '是否启用',
  `usage_count` INT DEFAULT 0 COMMENT '使用次数',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_module_scope` (`module_scope`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `knowledge_modules_creator_fk` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_modules_group_fk` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识模块表';

-- 2. 创建模块组合表
CREATE TABLE IF NOT EXISTS `module_combinations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL COMMENT '组合名称',
  `description` TEXT COMMENT '组合描述',
  `user_id` BIGINT NOT NULL COMMENT '创建者ID',
  `estimated_tokens` INT DEFAULT 0 COMMENT '预估的token数',
  `is_active` BOOLEAN DEFAULT TRUE COMMENT '是否启用',
  `usage_count` INT DEFAULT 0 COMMENT '使用次数',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `module_combinations_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块组合表';

-- 3. 创建组合-模块关联表
CREATE TABLE IF NOT EXISTS `combination_modules` (
  `combination_id` BIGINT NOT NULL COMMENT '组合ID',
  `module_id` BIGINT NOT NULL COMMENT '模块ID',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序顺序',
  `added_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`combination_id`, `module_id`),
  KEY `idx_module_id` (`module_id`),
  CONSTRAINT `combination_modules_combination_fk` FOREIGN KEY (`combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `combination_modules_module_fk` FOREIGN KEY (`module_id`) REFERENCES `knowledge_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组合-模块关联表';

-- 4. 在conversations表添加组合ID字段
ALTER TABLE `conversations` 
ADD COLUMN `module_combination_id` BIGINT DEFAULT NULL COMMENT '使用的模块组合ID' AFTER `system_prompt_id`,
ADD KEY `idx_module_combination_id` (`module_combination_id`),
ADD CONSTRAINT `conversations_module_combination_fk` FOREIGN KEY (`module_combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE SET NULL;

-- 5. 在系统设置表中添加万智台配置
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `setting_type`, `description`) 
VALUES 
('knowledge_module_name', '万智台', 'string', '知识模块功能的显示名称'),
('knowledge_module_enabled', 'true', 'boolean', '知识模块功能开关')
ON DUPLICATE KEY UPDATE 
  `setting_value` = VALUES(`setting_value`),
  `updated_at` = CURRENT_TIMESTAMP;

-- 6. 记录迁移版本
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('018_create_knowledge_modules', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
