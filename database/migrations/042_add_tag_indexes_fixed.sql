-- 添加标签系统性能索引（检查是否存在）
ALTER TABLE user_tag_relations ADD INDEX IF NOT EXISTS idx_user_tag (user_id, tag_id);
ALTER TABLE user_tag_relations ADD INDEX IF NOT EXISTS idx_tag_user (tag_id, user_id);
ALTER TABLE user_tags ADD INDEX IF NOT EXISTS idx_group_active (group_id, is_active);
-- idx_sort_order 已存在，跳过
