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

-- 先添加新的交易类型到现有的ENUM（保留所有现有类型）
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type VARCHAR(50) NOT NULL DEFAULT 'chat_consume'
COMMENT '交易类型（临时改为VARCHAR）';

-- 更新为新的ENUM（包含所有类型）
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type ENUM(
  'chat_consume', 'image_consume', 'video_consume', 
  'admin_add', 'admin_deduct', 'admin_set', 'admin_adjust',
  'storage_consume', 'html_publish', 'html_editor_publish',
  'mindmap_save', 'mindmap_export',
  'system_reward', 'system_deduct', 'manual_adjust'
) NOT NULL DEFAULT 'chat_consume'
COMMENT '交易类型';
