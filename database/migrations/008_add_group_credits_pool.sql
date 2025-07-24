-- 添加用户组积分池功能
-- 2025-01-18

-- 为user_groups表添加积分池字段
ALTER TABLE user_groups 
ADD COLUMN credits_pool INT DEFAULT 0 COMMENT '组积分池总额' AFTER sort_order,
ADD COLUMN credits_pool_used INT DEFAULT 0 COMMENT '组积分池已使用额度' AFTER credits_pool;

-- 添加索引
ALTER TABLE user_groups ADD INDEX idx_credits_pool (credits_pool, credits_pool_used);

-- 为credit_transactions表添加新的事务类型
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type ENUM('admin_add','admin_deduct','admin_set','chat_consume','system_reward','group_distribute') NOT NULL;

-- 添加分配者字段（记录是哪个组管理员分配的）
ALTER TABLE credit_transactions
ADD COLUMN distributor_id BIGINT DEFAULT NULL COMMENT '分配者ID（组内分配时记录）' AFTER operator_id,
ADD INDEX idx_distributor (distributor_id);
