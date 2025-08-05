-- 021_add_knowledge_module_group_ids.sql
-- 为知识模块添加用户组权限控制

-- 添加group_ids字段，用于控制系统级模块的可见性
ALTER TABLE `knowledge_modules` 
ADD COLUMN `group_ids` JSON DEFAULT NULL COMMENT '可见的用户组ID列表（仅系统级模块使用，NULL表示所有组可见）' 
AFTER `group_id`;

-- 添加注释说明
ALTER TABLE `knowledge_modules` 
MODIFY COLUMN `group_id` BIGINT DEFAULT NULL COMMENT '团队模块所属的组ID（仅团队模块使用）';

-- 记录迁移
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('021_add_knowledge_module_group_ids', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
