-- AI模型表添加图片上传支持字段
-- 创建时间: 2025-01-16

-- 检查字段是否存在，如果不存在则添加
DROP PROCEDURE IF EXISTS add_image_upload_column;

DELIMITER $$
CREATE PROCEDURE add_image_upload_column()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_models' 
        AND COLUMN_NAME = 'image_upload_enabled'
    ) THEN
        ALTER TABLE ai_models 
        ADD COLUMN image_upload_enabled TINYINT(1) DEFAULT 0 COMMENT '是否支持图片上传' 
        AFTER stream_enabled;
        
        -- 添加索引以提高查询效率
        ALTER TABLE ai_models 
        ADD INDEX idx_image_upload (image_upload_enabled);
    END IF;
END$$
DELIMITER ;

-- 执行存储过程
CALL add_image_upload_column();

-- 删除临时存储过程
DROP PROCEDURE IF EXISTS add_image_upload_column;

-- 更新已知支持图片的模型
UPDATE ai_models 
SET image_upload_enabled = 1 
WHERE name IN ('gpt-4', 'gpt-4-turbo', 'gpt-4-vision-preview', 'gpt-4v', 'openai/gpt-4.1-mini',
               'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 
               'gemini-pro-vision', 'gemini-1.5-pro', 'google/gemini-2.5-flash')
AND is_active = 1;

-- 提示信息
SELECT 'AI模型图片上传支持字段添加完成！' AS message;
SELECT id, name, display_name, image_upload_enabled 
FROM ai_models 
WHERE image_upload_enabled = 1
ORDER BY sort_order;
