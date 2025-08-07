-- 023_add_message_status.sql
-- 添加消息状态字段，用于跟踪流式消息的完成状态
-- 执行时间：2024-08-07

-- 使用存储过程安全地添加列
DELIMITER $$

DROP PROCEDURE IF EXISTS add_message_status_column$$
CREATE PROCEDURE add_message_status_column()
BEGIN
    -- 检查status列是否存在
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'messages' 
        AND COLUMN_NAME = 'status'
    ) THEN
        -- 添加status字段
        ALTER TABLE messages 
        ADD COLUMN status ENUM('pending', 'streaming', 'completed', 'failed') 
        DEFAULT 'completed' 
        COMMENT '消息状态：pending-待处理，streaming-流式传输中，completed-已完成，failed-失败'
        AFTER model_name;
    END IF;
    
    -- 检查并添加索引
    IF NOT EXISTS (
        SELECT * FROM information_schema.STATISTICS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'messages' 
        AND INDEX_NAME = 'idx_status'
    ) THEN
        ALTER TABLE messages ADD INDEX idx_status (status);
    END IF;
    
    IF NOT EXISTS (
        SELECT * FROM information_schema.STATISTICS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'messages' 
        AND INDEX_NAME = 'idx_conversation_status'
    ) THEN
        ALTER TABLE messages ADD INDEX idx_conversation_status (conversation_id, status);
    END IF;
END$$

DELIMITER ;

-- 执行存储过程
CALL add_message_status_column();
DROP PROCEDURE add_message_status_column;

-- 更新现有消息的状态为completed
UPDATE messages SET status = 'completed' WHERE status IS NULL;

-- 记录迁移历史
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('023_add_message_status', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
