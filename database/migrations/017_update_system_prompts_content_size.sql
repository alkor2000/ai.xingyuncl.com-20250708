-- 017_update_system_prompts_content_size.sql
-- 将系统提示词内容字段从TEXT升级为MEDIUMTEXT，支持更大的内容

-- 修改system_prompts表的content字段类型
ALTER TABLE system_prompts 
MODIFY COLUMN content MEDIUMTEXT NOT NULL COMMENT '提示词内容（支持最大16MB）';

-- 记录迁移版本
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('017_update_system_prompts_content_size', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
