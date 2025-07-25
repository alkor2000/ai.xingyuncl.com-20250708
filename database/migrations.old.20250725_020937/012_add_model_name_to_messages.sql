-- 为messages表添加model_name字段，记录生成消息时使用的AI模型
ALTER TABLE messages 
ADD COLUMN model_name VARCHAR(100) DEFAULT NULL COMMENT 'AI模型名称' AFTER tokens;

-- 添加索引以提高查询性能
ALTER TABLE messages ADD INDEX idx_model_name (model_name);

-- 更新现有的AI消息，使用对话的当前模型作为默认值
UPDATE messages m
JOIN conversations c ON m.conversation_id = c.id
SET m.model_name = c.model_name
WHERE m.role = 'assistant' AND m.model_name IS NULL;
