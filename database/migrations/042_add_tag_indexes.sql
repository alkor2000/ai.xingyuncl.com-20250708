-- 添加标签系统性能索引
ALTER TABLE user_tag_relations ADD INDEX idx_user_tag (user_id, tag_id);
ALTER TABLE user_tag_relations ADD INDEX idx_tag_user (tag_id, user_id);
ALTER TABLE user_tags ADD INDEX idx_group_active (group_id, is_active);
ALTER TABLE user_tags ADD INDEX idx_sort_order (sort_order);
