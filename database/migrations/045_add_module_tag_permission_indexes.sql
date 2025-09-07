-- 为知识模块标签权限表添加性能索引
ALTER TABLE knowledge_module_tag_permissions 
ADD INDEX idx_module_tag_combined (module_id, tag_id),
ADD INDEX idx_created_by_date (created_by, created_at);

-- 为知识模块表添加复合索引
ALTER TABLE knowledge_modules 
ADD INDEX idx_scope_group_active (module_scope, group_id, is_active);
