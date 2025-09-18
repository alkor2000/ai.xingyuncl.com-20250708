-- 添加OCR相关的事务类型到credit_transactions表
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type 
ENUM(
  'admin_add',
  'admin_deduct', 
  'admin_set',
  'chat_consume',
  'image_consume',
  'video_consume',
  'system_reward',
  'group_distribute',
  'group_recycle',
  'api_consume',
  'html_create',
  'html_update',
  'html_publish',
  'storage_upload',
  'mindmap_save',
  'mindmap_export',
  'ocr_consume'     -- 新增：OCR识别消费
) DEFAULT 'chat_consume';

-- 添加索引优化查询性能（如果不存在）
-- ALTER TABLE credit_transactions ADD INDEX IF NOT EXISTS idx_transaction_type_created (transaction_type, created_at);
