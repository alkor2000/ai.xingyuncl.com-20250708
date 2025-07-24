-- 添加性能优化索引
-- 注意：MySQL不支持IF NOT EXISTS语法，所以先尝试删除再创建

-- messages表索引
DROP INDEX idx_messages_conversation_created ON messages;
CREATE INDEX idx_messages_conversation_created 
ON messages(conversation_id, created_at DESC);

DROP INDEX idx_messages_role ON messages;
CREATE INDEX idx_messages_role 
ON messages(role);

DROP INDEX idx_messages_model_name ON messages;
CREATE INDEX idx_messages_model_name 
ON messages(model_name);

-- conversations表索引
DROP INDEX idx_conversations_user_created ON conversations;
CREATE INDEX idx_conversations_user_created 
ON conversations(user_id, created_at DESC);

DROP INDEX idx_conversations_user_priority ON conversations;
CREATE INDEX idx_conversations_user_priority 
ON conversations(user_id, priority DESC, created_at DESC);

DROP INDEX idx_conversations_cleared_at ON conversations;
CREATE INDEX idx_conversations_cleared_at 
ON conversations(cleared_at);

-- user_activities表索引
DROP INDEX idx_user_activities_created ON user_activities;
CREATE INDEX idx_user_activities_created 
ON user_activities(created_at);

DROP INDEX idx_user_activities_user_created ON user_activities;
CREATE INDEX idx_user_activities_user_created 
ON user_activities(user_id, created_at);

-- billing_logs表索引
DROP INDEX idx_billing_logs_user_created ON billing_logs;
CREATE INDEX idx_billing_logs_user_created 
ON billing_logs(user_id, created_at DESC);

DROP INDEX idx_billing_logs_model_created ON billing_logs;
CREATE INDEX idx_billing_logs_model_created 
ON billing_logs(ai_model_id, created_at DESC);

-- credit_transactions表索引
DROP INDEX idx_credit_transactions_user_created ON credit_transactions;
CREATE INDEX idx_credit_transactions_user_created 
ON credit_transactions(user_id, created_at DESC);

-- files表索引
DROP INDEX idx_files_user_created ON files;
CREATE INDEX idx_files_user_created 
ON files(user_id, created_at DESC);
