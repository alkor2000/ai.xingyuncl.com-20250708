-- ============================================
-- 添加 Sora 2 视频模型配置
-- ============================================

-- 插入 Sora 2 模型（使用INSERT IGNORE避免重复）
INSERT IGNORE INTO video_models (
  name,
  display_name,
  description,
  provider,
  endpoint,
  api_key,
  model_id,
  generation_type,
  api_config,
  supports_text_to_video,
  supports_image_to_video,
  supports_first_frame,
  supports_last_frame,
  resolutions_supported,
  durations_supported,
  fps_supported,
  ratios_supported,
  max_prompt_length,
  default_resolution,
  default_duration,
  default_fps,
  default_ratio,
  base_price,
  price_config,
  example_prompt,
  icon,
  is_active,
  sort_order,
  created_at,
  updated_at
) VALUES (
  'sora-2',
  'OpenAI Sora 2',
  'OpenAI Sora 2 视频生成模型，支持纯文本和图片参考生成，最高1280x720分辨率',
  'sora2_goapi',
  'https://goapi.gptnb.ai',
  '', -- API Key留空，由管理员在后台配置
  'sora-2',
  'async',
  JSON_OBJECT(
    'create_endpoint', '/sora2/v1/create',
    'query_endpoint', '/sora2/v1/query',
    'auto_download_to_oss', true,
    'download_gif_preview', true,
    'orientations', JSON_ARRAY('portrait', 'landscape', 'square')
  ),
  1, -- supports_text_to_video
  1, -- supports_image_to_video
  0, -- supports_first_frame
  0, -- supports_last_frame
  JSON_ARRAY('352x640', '640x352', '640x640'), -- portrait, landscape, square
  JSON_ARRAY(4, 8), -- 4秒或8秒
  JSON_ARRAY(24), -- 24fps
  JSON_ARRAY('9:16', '16:9', '1:1'), -- portrait, landscape, square
  2000,
  '640x352', -- 默认横屏
  4,
  24,
  '16:9',
  100.00,
  JSON_OBJECT(
    'duration_multiplier', JSON_OBJECT('4', 1, '8', 2),
    'orientation_multiplier', JSON_OBJECT('portrait', 1, 'landscape', 1, 'square', 1),
    'with_image_extra', 50
  ),
  'A cute cat playing with a ball of yarn in a cozy living room',
  'VideoCameraOutlined',
  0, -- 默认禁用，需要管理员配置API Key后启用
  10,
  NOW(),
  NOW()
);

-- 验证插入
SELECT '✅ Sora 2 模型配置已添加！' as status;
SELECT id, name, display_name, provider, is_active 
FROM video_models 
WHERE provider = 'sora2_goapi';
