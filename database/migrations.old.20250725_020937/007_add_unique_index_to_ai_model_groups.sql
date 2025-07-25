-- 为 ai_model_groups 表添加唯一索引
-- 创建时间: 2025-01-18

-- 检查表是否存在
DROP PROCEDURE IF EXISTS add_unique_index_to_ai_model_groups;

DELIMITER $$
CREATE PROCEDURE add_unique_index_to_ai_model_groups()
BEGIN
    -- 检查唯一索引是否存在
    IF NOT EXISTS (
        SELECT * FROM information_schema.STATISTICS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_model_groups' 
        AND INDEX_NAME = 'uk_model_group'
    ) THEN
        -- 删除可能的重复数据（保留最早的）
        DELETE mg1 FROM ai_model_groups mg1
        INNER JOIN ai_model_groups mg2 
        WHERE mg1.id > mg2.id 
        AND mg1.model_id = mg2.model_id 
        AND mg1.group_id = mg2.group_id;
        
        -- 添加唯一索引
        ALTER TABLE ai_model_groups 
        ADD UNIQUE KEY uk_model_group (model_id, group_id);
    END IF;
    
    -- 添加外键约束（如果不存在）
    IF NOT EXISTS (
        SELECT * FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_model_groups' 
        AND CONSTRAINT_NAME = 'fk_model_group_model'
    ) THEN
        ALTER TABLE ai_model_groups 
        ADD CONSTRAINT fk_model_group_model 
        FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT * FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_model_groups' 
        AND CONSTRAINT_NAME = 'fk_model_group_group'
    ) THEN
        ALTER TABLE ai_model_groups 
        ADD CONSTRAINT fk_model_group_group 
        FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE;
    END IF;
END$$
DELIMITER ;

-- 执行存储过程
CALL add_unique_index_to_ai_model_groups();

-- 删除临时存储过程
DROP PROCEDURE IF EXISTS add_unique_index_to_ai_model_groups;

-- 提示信息
SELECT 'AI模型分组唯一索引和外键约束添加完成！' AS message;

-- 查看表结构
DESCRIBE ai_model_groups;
