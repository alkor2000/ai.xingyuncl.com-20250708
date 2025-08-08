-- 024_add_message_sequence.sql
-- 添加消息序号字段，解决消息顺序错乱问题
-- 执行时间：2025-08-08

-- 使用存储过程安全地添加列
DELIMITER $$

DROP PROCEDURE IF EXISTS add_sequence_number_column$$
CREATE PROCEDURE add_sequence_number_column()
BEGIN
    -- 检查sequence_number列是否存在
    IF NOT EXISTS (
        SELECT * FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'messages' 
        AND COLUMN_NAME = 'sequence_number'
    ) THEN
        -- 添加sequence_number字段
        ALTER TABLE messages 
        ADD COLUMN sequence_number INT DEFAULT 0 
        COMMENT '消息序号，用于保证正确的显示顺序' 
        AFTER conversation_id;
        
        -- 更新现有消息的序号
        SET @row_number = 0;
        SET @prev_conv = '';
        
        UPDATE messages m1
        INNER JOIN (
            SELECT 
                id,
                conversation_id,
                @row_number := CASE 
                    WHEN @prev_conv = conversation_id 
                    THEN @row_number + 1 
                    ELSE 1 
                END AS seq_num,
                @prev_conv := conversation_id
            FROM messages
            ORDER BY conversation_id, created_at ASC, 
                     CASE role WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END
        ) m2 ON m1.id = m2.id
        SET m1.sequence_number = m2.seq_num;
    END IF;
    
    -- 检查并添加索引
    IF NOT EXISTS (
        SELECT * FROM information_schema.STATISTICS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'messages' 
        AND INDEX_NAME = 'idx_conversation_sequence'
    ) THEN
        ALTER TABLE messages ADD INDEX idx_conversation_sequence (conversation_id, sequence_number, created_at);
    END IF;
END$$

DELIMITER ;

-- 执行存储过程
CALL add_sequence_number_column();
DROP PROCEDURE add_sequence_number_column;

-- 记录迁移历史
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('024_add_message_sequence', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
