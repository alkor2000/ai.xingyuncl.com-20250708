-- 添加HTML编辑器相关的事务类型到credit_transactions表
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type 
ENUM(
  'admin_add',
  'admin_deduct', 
  'admin_set',
  'chat_consume',
  'image_consume',
  'system_reward',
  'group_distribute',
  'group_recycle',
  'api_consume',
  'html_create',     -- 新增：HTML页面创建
  'html_update',     -- 新增：HTML页面更新
  'html_publish'     -- 新增：HTML页面发布
);

-- 添加索引优化查询性能
ALTER TABLE credit_transactions ADD INDEX idx_transaction_type_created (transaction_type, created_at);
