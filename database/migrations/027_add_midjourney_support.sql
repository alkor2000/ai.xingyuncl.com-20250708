-- 添加Midjourney支持
-- 2025-01-15

-- 1. 修改image_models表，添加生成类型和API配置
ALTER TABLE image_models 
ADD COLUMN generation_type ENUM('sync', 'async') DEFAULT 'sync' COMMENT '生成类型：sync同步/async异步' AFTER provider,
ADD COLUMN api_config JSON DEFAULT NULL COMMENT 'API特定配置（如Midjourney的mode等）' AFTER model_id,
ADD COLUMN webhook_url VARCHAR(500) DEFAULT NULL COMMENT 'Webhook回调地址' AFTER api_config,
ADD COLUMN polling_interval INT DEFAULT 2000 COMMENT '轮询间隔（毫秒）' AFTER webhook_url,
ADD COLUMN max_polling_time INT DEFAULT 300000 COMMENT '最大轮询时间（毫秒）' AFTER polling_interval;

-- 2. 修改image_generations表，支持Midjourney特性
ALTER TABLE image_generations 
ADD COLUMN task_id VARCHAR(100) DEFAULT NULL COMMENT 'Midjourney任务ID' AFTER model_id,
ADD COLUMN task_status ENUM('NOT_START', 'SUBMITTED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE') DEFAULT NULL COMMENT '任务状态' AFTER status,
ADD COLUMN parent_id BIGINT DEFAULT NULL COMMENT '父生成记录ID（用于U/V操作）' AFTER user_id,
ADD COLUMN action_type VARCHAR(20) DEFAULT 'IMAGINE' COMMENT '操作类型（IMAGINE/UPSCALE/VARIATION/REROLL等）' AFTER parent_id,
ADD COLUMN action_index INT DEFAULT NULL COMMENT '操作索引（1-4）' AFTER action_type,
ADD COLUMN buttons JSON DEFAULT NULL COMMENT '可用操作按钮' AFTER action_index,
ADD COLUMN generation_mode VARCHAR(20) DEFAULT 'fast' COMMENT '生成模式（fast/turbo/relax）' AFTER buttons,
ADD COLUMN progress VARCHAR(50) DEFAULT NULL COMMENT '进度信息' AFTER generation_mode,
ADD COLUMN grid_layout TINYINT(1) DEFAULT 0 COMMENT '是否为4图网格' AFTER progress,
ADD COLUMN mj_custom_id VARCHAR(255) DEFAULT NULL COMMENT 'Midjourney customId' AFTER grid_layout,
ADD COLUMN prompt_en TEXT DEFAULT NULL COMMENT '英文提示词' AFTER negative_prompt,
ADD COLUMN fail_reason TEXT DEFAULT NULL COMMENT '失败原因' AFTER error_message,
ADD INDEX idx_task_id (task_id),
ADD INDEX idx_parent_id (parent_id),
ADD INDEX idx_task_status (task_status),
ADD CONSTRAINT fk_parent_generation FOREIGN KEY (parent_id) REFERENCES image_generations(id) ON DELETE CASCADE;

-- 3. 创建Midjourney任务队列表（用于管理异步任务）
CREATE TABLE IF NOT EXISTS midjourney_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  generation_id BIGINT DEFAULT NULL,
  task_id VARCHAR(100) UNIQUE NOT NULL,
  action VARCHAR(20) NOT NULL COMMENT '操作类型',
  status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
  submit_time BIGINT NOT NULL COMMENT '提交时间戳',
  start_time BIGINT DEFAULT NULL COMMENT '开始时间戳',
  finish_time BIGINT DEFAULT NULL COMMENT '完成时间戳',
  properties JSON DEFAULT NULL COMMENT '扩展属性',
  webhook_url VARCHAR(500) DEFAULT NULL,
  retry_count INT DEFAULT 0 COMMENT '重试次数',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_submit_time (submit_time),
  CONSTRAINT fk_mj_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mj_generation FOREIGN KEY (generation_id) REFERENCES image_generations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Midjourney任务队列';

-- 4. 插入Midjourney模型示例（需要管理员后续配置）
INSERT INTO image_models (
  name,
  display_name,
  description,
  provider,
  generation_type,
  endpoint,
  model_id,
  price_per_image,
  sizes_supported,
  max_prompt_length,
  default_size,
  example_prompt,
  icon,
  is_active,
  sort_order,
  api_config
) VALUES (
  'midjourney-v6',
  'Midjourney V6',
  '最新的Midjourney V6模型，生成高质量艺术图像',
  'midjourney',
  'async',
  'https://api.example.com/mj',  -- 需要替换为实际的API地址
  'MID_JOURNEY',
  10.00,  -- 每张图片10积分
  '["1:1", "4:3", "3:4", "16:9", "9:16"]',
  4000,
  '1:1',
  'a beautiful landscape painting in the style of Claude Monet --v 6',
  'PictureOutlined',
  0,  -- 默认未激活，需要配置API后激活
  5,
  JSON_OBJECT(
    'modes', JSON_ARRAY('fast', 'turbo', 'relax'),
    'default_mode', 'fast',
    'support_variation', true,
    'support_upscale', true,
    'support_reroll', true,
    'support_zoom', true,
    'support_pan', true,
    'grid_size', 4
  )
);

-- 5. 添加系统配置项
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('midjourney_polling_enabled', 'true', '是否启用Midjourney任务轮询'),
('midjourney_polling_interval', '2000', 'Midjourney轮询间隔（毫秒）'),
('midjourney_max_polling_time', '300000', 'Midjourney最大轮询时间（毫秒）'),
('midjourney_webhook_secret', '', 'Midjourney Webhook密钥')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
