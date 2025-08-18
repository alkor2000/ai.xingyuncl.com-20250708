-- 添加HTML编辑器发布页面的积分配置
INSERT INTO system_settings (setting_key, setting_value, setting_type, description)
VALUES 
  ('html_editor.credits_per_publish', '5', 'number', '发布HTML页面（生成永久链接）消耗的积分')
ON DUPLICATE KEY UPDATE 
  setting_value = VALUES(setting_value),
  setting_type = VALUES(setting_type),
  description = VALUES(description);
