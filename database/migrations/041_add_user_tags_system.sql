-- 041_add_user_tags_system.sql
-- 添加用户标签系统 - 支持组内精细化管理
-- 执行时间：2025-09-07

-- 1. 创建用户标签定义表
CREATE TABLE IF NOT EXISTS `user_tags` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `group_id` bigint NOT NULL COMMENT '所属用户组ID',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签名称',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1677ff' COMMENT '标签颜色',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '标签描述',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '图标名称',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_by` bigint DEFAULT NULL COMMENT '创建者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_tag_name` (`group_id`, `name`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_user_tags_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_tags_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户标签定义表';

-- 2. 创建用户标签关系表
CREATE TABLE IF NOT EXISTS `user_tag_relations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `tag_id` bigint NOT NULL COMMENT '标签ID',
  `assigned_by` bigint DEFAULT NULL COMMENT '分配者用户ID',
  `assigned_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '分配时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_tag` (`user_id`, `tag_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_tag_id` (`tag_id`),
  KEY `idx_assigned_by` (`assigned_by`),
  KEY `idx_assigned_at` (`assigned_at`),
  CONSTRAINT `fk_tag_relations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tag_relations_tag` FOREIGN KEY (`tag_id`) REFERENCES `user_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tag_relations_assigner` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户标签关系表';

-- 3. 为用户表添加标签统计字段（可选，用于性能优化）
ALTER TABLE `users` 
ADD COLUMN IF NOT EXISTS `tag_count` int DEFAULT '0' COMMENT '标签数量' AFTER `remark`;

-- 4. 创建视图：用户标签详情视图（方便查询）
CREATE OR REPLACE VIEW `v_user_tags_detail` AS
SELECT 
  utr.id as relation_id,
  utr.user_id,
  u.username,
  u.email,
  u.group_id as user_group_id,
  ut.id as tag_id,
  ut.name as tag_name,
  ut.color as tag_color,
  ut.description as tag_description,
  ut.icon as tag_icon,
  ut.group_id as tag_group_id,
  ug.name as group_name,
  utr.assigned_at,
  utr.assigned_by,
  assigner.username as assigned_by_username
FROM user_tag_relations utr
JOIN users u ON utr.user_id = u.id
JOIN user_tags ut ON utr.tag_id = ut.id
JOIN user_groups ug ON ut.group_id = ug.id
LEFT JOIN users assigner ON utr.assigned_by = assigner.id
WHERE ut.is_active = 1;

-- 5. 插入默认标签（只为存在的组创建，不指定创建者）
INSERT INTO `user_tags` (`group_id`, `name`, `color`, `description`, `icon`, `sort_order`)
SELECT 
  id as group_id,
  '核心成员' as name,
  '#52c41a' as color,
  '组内核心成员标签' as description,
  'StarOutlined' as icon,
  1 as sort_order
FROM `user_groups`
WHERE id > 1 AND is_active = 1
ON DUPLICATE KEY UPDATE updated_at = NOW();

INSERT INTO `user_tags` (`group_id`, `name`, `color`, `description`, `icon`, `sort_order`)
SELECT 
  id as group_id,
  '技术支持' as name,
  '#1890ff' as color,
  '技术支持部门成员' as description,
  'ToolOutlined' as icon,
  2 as sort_order
FROM `user_groups`
WHERE id > 1 AND is_active = 1
ON DUPLICATE KEY UPDATE updated_at = NOW();

-- 6. 更新数据库版本记录
INSERT INTO `system_configs` (`key`, `value`, `description`, `created_at`)
VALUES ('db_migration_041', '1', '用户标签系统已安装', NOW())
ON DUPLICATE KEY UPDATE 
  `value` = '1',
  `updated_at` = NOW();

-- 完成提示
SELECT '✅ 用户标签系统数据库迁移完成' as message;
