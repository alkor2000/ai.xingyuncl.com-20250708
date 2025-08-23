-- 035_add_token_count_to_modules.sql
-- 为知识模块添加token统计字段

-- 1. 给knowledge_modules表添加token_count字段
ALTER TABLE `knowledge_modules` 
ADD COLUMN `token_count` INT DEFAULT 0 COMMENT 'Token数量估算' AFTER `content`;

-- 2. 更新现有记录的token_count（使用更准确的估算）
UPDATE `knowledge_modules` 
SET `token_count` = CASE
    -- 中文为主的内容，每个字符约1.5个token
    WHEN LENGTH(content) != CHAR_LENGTH(content) THEN CEIL(CHAR_LENGTH(content) * 1.5)
    -- 英文为主的内容，每4个字符约1个token
    ELSE CEIL(LENGTH(content) / 4)
END;

-- 3. 记录迁移版本
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('035_add_token_count_to_modules', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
