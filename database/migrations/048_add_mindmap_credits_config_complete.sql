-- 添加思维导图积分配置到系统设置表
-- 使用系统配置表存储，无需新建表

-- 插入默认配置
INSERT INTO system_settings (setting_key, setting_value, setting_type, created_at, updated_at)
VALUES 
  ('mindmap.save_credits', '5', 'number', NOW(), NOW()),
  ('mindmap.export_svg_credits', '2', 'number', NOW(), NOW()),
  ('mindmap.export_markdown_credits', '1', 'number', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  updated_at = NOW();

-- 更新ENUM，包含所有现有类型和新类型
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type ENUM(
  'admin_add', 'admin_deduct', 'admin_set',
  'chat_consume', 'image_consume', 'video_consume',
  'system_reward', 
  'group_distribute', 'group_recycle',
  'api_consume',
  'html_create', 'html_update', 'html_publish',
  'storage_upload',
  'mindmap_save', 'mindmap_export'
) DEFAULT 'chat_consume'
COMMENT '交易类型';
