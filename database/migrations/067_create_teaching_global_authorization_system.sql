/**
 * 067_create_teaching_global_authorization_system.sql
 * 创建教学模块全局授权管理系统
 * 
 * 功能：
 * - 存储组-标签-用户三级授权配置
 * - 支持模块和课程级别的权限控制
 * - 支持权限继承机制
 * - JSON格式存储灵活的授权数据结构
 */

-- 创建全局授权配置表
CREATE TABLE IF NOT EXISTS `teaching_global_authorizations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `group_id` BIGINT NOT NULL COMMENT '用户组ID',
  `config_data` JSON NOT NULL COMMENT '授权配置数据（JSON格式）',
  `created_by` BIGINT NOT NULL COMMENT '创建者用户ID',
  `updated_by` BIGINT NOT NULL COMMENT '最后更新者用户ID',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_id` (`group_id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_updated_by` (`updated_by`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_global_auth_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_global_auth_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_global_auth_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块全局授权配置表';

-- 扩展 teaching_permissions 表支持课程级权限
ALTER TABLE `teaching_permissions` 
ADD COLUMN `lesson_id` BIGINT NULL COMMENT '课程ID（NULL表示模块级权限）' AFTER `module_id`,
ADD KEY `idx_lesson_id` (`lesson_id`),
ADD CONSTRAINT `fk_teaching_permissions_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `teaching_lessons` (`id`) ON DELETE CASCADE;

-- 修改唯一约束以支持课程级权限
ALTER TABLE `teaching_permissions` 
DROP INDEX `uk_module_user_type`,
DROP INDEX `uk_module_group_type`,
DROP INDEX `uk_module_tag_type`;

ALTER TABLE `teaching_permissions`
ADD UNIQUE KEY `uk_module_lesson_user_type` (`module_id`, `lesson_id`, `user_id`, `permission_type`),
ADD UNIQUE KEY `uk_module_lesson_group_type` (`module_id`, `lesson_id`, `group_id`, `permission_type`),
ADD UNIQUE KEY `uk_module_lesson_tag_type` (`module_id`, `lesson_id`, `tag_id`, `permission_type`);

-- 添加索引优化查询性能
ALTER TABLE `teaching_permissions`
ADD KEY `idx_module_lesson` (`module_id`, `lesson_id`);

-- 记录迁移
INSERT INTO `schema_migrations` (`version`, `description`, `executed_at`) 
VALUES ('067', 'create_teaching_global_authorization_system', NOW());
