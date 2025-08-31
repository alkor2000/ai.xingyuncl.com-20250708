-- =====================================================
-- 迁移脚本：视频生成系统
-- 版本：038
-- 日期：2025-08-29
-- 描述：添加视频生成功能的数据库结构
-- =====================================================

-- 1. 创建视频模型配置表
CREATE TABLE IF NOT EXISTS `video_models` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型标识',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模型描述',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'volcano' COMMENT '提供商',
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'API端点',
  `api_key` text COLLATE utf8mb4_unicode_ci COMMENT '加密的API密钥',
  `model_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型ID',
  `generation_type` enum('sync','async') DEFAULT 'async' COMMENT '生成类型',
  `api_config` json DEFAULT NULL COMMENT 'API配置（webhook等）',
  
  -- 支持的能力
  `supports_text_to_video` tinyint(1) DEFAULT '1' COMMENT '支持文生视频',
  `supports_image_to_video` tinyint(1) DEFAULT '0' COMMENT '支持图生视频',
  `supports_first_frame` tinyint(1) DEFAULT '0' COMMENT '支持首帧图生视频',
  `supports_last_frame` tinyint(1) DEFAULT '0' COMMENT '支持尾帧图生视频',
  
  -- 参数限制
  `resolutions_supported` json DEFAULT NULL COMMENT '支持的分辨率列表',
  `durations_supported` json DEFAULT NULL COMMENT '支持的时长列表（秒）',
  `fps_supported` json DEFAULT NULL COMMENT '支持的帧率列表',
  `ratios_supported` json DEFAULT NULL COMMENT '支持的宽高比列表',
  `max_prompt_length` int DEFAULT '500' COMMENT '最大提示词长度',
  
  -- 默认参数
  `default_resolution` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '720p' COMMENT '默认分辨率',
  `default_duration` int DEFAULT '5' COMMENT '默认时长（秒）',
  `default_fps` int DEFAULT '24' COMMENT '默认帧率',
  `default_ratio` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '16:9' COMMENT '默认宽高比',
  
  -- 价格配置（基础价格，实际价格根据参数计算）
  `base_price` decimal(10,2) DEFAULT '50.00' COMMENT '基础价格（积分）',
  `price_config` json DEFAULT NULL COMMENT '价格配置（分辨率和时长系数）',
  
  -- 其他配置
  `example_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '示例提示词',
  `example_video` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '示例视频URL',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'VideoCameraOutlined' COMMENT '图标',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_active` (`is_active`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频生成模型配置表';

-- 2. 创建视频生成历史表
CREATE TABLE IF NOT EXISTS `video_generations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `model_id` bigint NOT NULL COMMENT '模型ID',
  
  -- 生成参数
  `prompt` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词',
  `negative_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '负面提示词',
  `first_frame_image` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '首帧图片URL',
  `last_frame_image` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '尾帧图片URL',
  `generation_mode` enum('text_to_video','image_to_video','first_frame','last_frame','first_last_frame') DEFAULT 'text_to_video' COMMENT '生成模式',
  
  -- 视频参数
  `resolution` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分辨率',
  `duration` int NOT NULL COMMENT '时长（秒）',
  `fps` int DEFAULT '24' COMMENT '帧率',
  `ratio` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '16:9' COMMENT '宽高比',
  `seed` int DEFAULT '-1' COMMENT '随机种子',
  `watermark` tinyint(1) DEFAULT '0' COMMENT '是否添加水印',
  `camera_fixed` tinyint(1) DEFAULT '0' COMMENT '是否固定摄像头',
  
  -- 任务状态
  `task_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '火山方舟任务ID',
  `status` enum('pending','submitted','queued','running','succeeded','failed','cancelled') DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT '0' COMMENT '生成进度（0-100）',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  
  -- 结果文件
  `video_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始视频URL（火山方舟返回）',
  `local_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地/OSS存储路径',
  `thumbnail_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缩略图路径',
  `preview_gif_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '预览GIF路径',
  `last_frame_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '尾帧图片路径',
  `file_size` bigint DEFAULT NULL COMMENT '文件大小（字节）',
  `video_width` int DEFAULT NULL COMMENT '视频宽度',
  `video_height` int DEFAULT NULL COMMENT '视频高度',
  `video_duration` float DEFAULT NULL COMMENT '实际视频时长（秒）',
  
  -- 积分和统计
  `credits_consumed` decimal(10,2) DEFAULT '0.00' COMMENT '消耗积分',
  `generation_time` int DEFAULT NULL COMMENT '生成耗时（秒）',
  `is_favorite` tinyint(1) DEFAULT '0' COMMENT '是否收藏',
  `is_public` tinyint(1) DEFAULT '0' COMMENT '是否公开',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `download_count` int DEFAULT '0' COMMENT '下载次数',
  
  -- 时间戳
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_model` (`model_id`),
  KEY `idx_task` (`task_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_public` (`is_public`),
  KEY `idx_favorite` (`is_favorite`),
  CONSTRAINT `video_generations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `video_generations_ibfk_2` FOREIGN KEY (`model_id`) REFERENCES `video_models` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频生成历史表';

-- 3. 修改credit_transactions表，添加video_consume枚举值（保留所有现有值）
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type ENUM(
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
  'storage_upload'
) DEFAULT NULL;

-- 4. 插入视频生成系统模块
INSERT INTO system_modules (
  name,
  display_name,
  description,
  module_type,
  module_category,
  route_path,
  module_url,
  open_mode,
  menu_icon,
  proxy_path,
  auth_mode,
  is_active,
  can_disable,
  sort_order
) VALUES (
  'video_generation',
  '视频生成',
  'AI视频生成功能，支持文字生成视频',
  'frontend',
  'system',
  '/video',
  '/video',
  'iframe',
  'VideoCameraOutlined',
  '/video',
  'none',
  1,
  1,
  36
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  route_path = VALUES(route_path),
  module_url = VALUES(module_url);

-- 5. 插入默认的Doubao-Seedance视频模型
INSERT INTO video_models (
  name,
  display_name,
  description,
  provider,
  endpoint,
  model_id,
  generation_type,
  supports_text_to_video,
  supports_image_to_video,
  supports_first_frame,
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
  sort_order
) VALUES (
  'doubao_seedance_pro',
  'Doubao-Seedance-1.0-pro',
  '字节跳动豆包视频生成模型，支持文生视频、首帧图生视频，最高1080P分辨率',
  'volcano',
  'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
  'doubao-seedance-1-0-pro-250528',
  'async',
  1,
  1, 
  1,
  JSON_ARRAY('480p', '720p', '1080p'),
  JSON_ARRAY(5, 10),
  JSON_ARRAY(24),
  JSON_ARRAY('16:9', '4:3', '1:1', '3:4', '9:16', '21:9'),
  500,
  '720p',
  5,
  24,
  '16:9',
  50.00,
  JSON_OBJECT(
    'resolution_multiplier', JSON_OBJECT(
      '480p', 1.0,
      '720p', 1.5,
      '1080p', 2.0
    ),
    'duration_multiplier', JSON_OBJECT(
      '5', 1.0,
      '10', 2.0
    )
  ),
  '多个镜头。一名侦探进入一间光线昏暗的房间。他检查桌上的线索，手里拿起桌上的某个物品。镜头转向他正在思索。',
  'VideoCameraOutlined',
  1,
  1
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  endpoint = VALUES(endpoint),
  model_id = VALUES(model_id);

-- 6. 创建索引优化查询
ALTER TABLE video_generations ADD INDEX idx_user_status (user_id, status);
ALTER TABLE video_generations ADD INDEX idx_completed (completed_at);

-- =====================================================
-- 迁移完成
-- =====================================================
