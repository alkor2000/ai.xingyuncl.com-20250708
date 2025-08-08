-- 023_add_message_status.sql
-- 添加消息状态字段，用于跟踪流式消息的完成状态
-- 简化版本，避免DELIMITER问题

-- 安全地添加status列（如果不存在）
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS status ENUM('pending', 'streaming', 'completed', 'failed') 
DEFAULT 'completed' 
COMMENT '消息状态：pending-待处理，streaming-流式传输中，completed-已完成，failed-失败'
AFTER model_name;

-- 添加索引（如果不存在）
ALTER TABLE messages ADD INDEX IF NOT EXISTS idx_status (status);
ALTER TABLE messages ADD INDEX IF NOT EXISTS idx_conversation_status (conversation_id, status);

-- 更新现有消息的状态为completed
UPDATE messages SET status = 'completed' WHERE status IS NULL;

-- 创建迁移历史表（如果不存在）
CREATE TABLE IF NOT EXISTS migrations_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(255) UNIQUE,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 记录迁移历史
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('023_add_message_status', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
