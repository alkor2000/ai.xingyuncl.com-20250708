-- =====================================================
-- 迁移脚本：完整的图像生成系统
-- 版本：025
-- 日期：2025-08-09
-- 描述：添加图像生成功能的所有数据库结构和初始数据
-- =====================================================

-- 1. 创建图像模型配置表
CREATE TABLE IF NOT EXISTS `image_models` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型标识',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模型描述',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'volcano' COMMENT '提供商：volcano/openai/stable-diffusion',
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'API端点',
  `api_key` text COLLATE utf8mb4_unicode_ci COMMENT '加密的API密钥',
  `model_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型ID，如doubao-seedream-3-0-t2i-250415',
  `price_per_image` decimal(10,2) DEFAULT '1.00' COMMENT '每张图片消耗积分',
  `sizes_supported` json DEFAULT NULL COMMENT '支持的尺寸列表',
  `max_prompt_length` int DEFAULT '1000' COMMENT '最大提示词长度',
  `default_size` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '1024x1024' COMMENT '默认尺寸',
  `default_guidance_scale` float DEFAULT '2.5' COMMENT '默认引导系数',
  `example_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '示例提示词',
  `example_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '示例图片URL',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PictureOutlined' COMMENT '图标',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_active` (`is_active`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图像生成模型配置表';

-- 2. 创建图片生成历史表
CREATE TABLE IF NOT EXISTS `image_generations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `model_id` bigint NOT NULL COMMENT '模型ID',
  `prompt` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词',
  `negative_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '负面提示词',
  `size` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '图片尺寸',
  `seed` int DEFAULT '-1' COMMENT '随机种子',
  `guidance_scale` float DEFAULT '2.5' COMMENT '引导系数',
  `watermark` tinyint(1) DEFAULT '1' COMMENT '是否添加水印',
  `image_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始图片URL（火山方舟返回）',
  `local_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地存储路径',
  `thumbnail_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缩略图路径',
  `file_size` int DEFAULT NULL COMMENT '文件大小（字节）',
  `status` enum('pending','generating','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `credits_consumed` decimal(10,2) DEFAULT '0.00' COMMENT '消耗积分',
  `generation_time` int DEFAULT NULL COMMENT '生成耗时（毫秒）',
  `is_favorite` tinyint(1) DEFAULT '0' COMMENT '是否收藏',
  `is_public` tinyint(1) DEFAULT '0' COMMENT '是否公开',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_model` (`model_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_favorite` (`is_favorite`),
  CONSTRAINT `image_generations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `image_generations_ibfk_2` FOREIGN KEY (`model_id`) REFERENCES `image_models` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图片生成历史表';

-- 3. 修改credit_transactions表，添加image_consume枚举值
-- 先检查是否已存在image_consume
SET @has_image_consume = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'credit_transactions'
    AND COLUMN_NAME = 'transaction_type'
    AND COLUMN_TYPE LIKE '%image_consume%'
);

-- 如果不存在，则添加
SET @sql = IF(@has_image_consume = 0,
  'ALTER TABLE credit_transactions 
   MODIFY COLUMN transaction_type ENUM(
     ''admin_add'', 
     ''admin_deduct'', 
     ''admin_set'', 
     ''chat_consume'',
     ''image_consume'',
     ''system_reward'',
     ''group_distribute'',
     ''group_recycle'',
     ''api_consume''
   ) DEFAULT NULL',
  'SELECT ''image_consume already exists in transaction_type'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. 插入图像生成系统模块（如果不存在）
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
  'image_generation',
  '图像生成',
  'AI图像生成功能，支持文字生成图片',
  'frontend',
  'system',
  '/image',
  '/image',
  'iframe',
  'PictureOutlined',
  '/image',
  'none',
  1,
  1,
  35
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  route_path = VALUES(route_path),
  module_url = VALUES(module_url),
  is_active = 1;

-- 5. 插入默认的火山方舟SeedDream模型（如果不存在）
INSERT INTO image_models (
  name,
  display_name,
  description,
  provider,
  endpoint,
  model_id,
  price_per_image,
  sizes_supported,
  max_prompt_length,
  default_size,
  default_guidance_scale,
  example_prompt,
  icon,
  is_active,
  sort_order
) VALUES (
  'volcano_seedream',
  '豆包-SeedDream-3.0',
  '火山方舟豆包文生图大模型，支持多种尺寸和风格',
  'volcano',
  'https://ark.cn-beijing.volces.com/api/v3/images/generations',
  'doubao-seedream-3-0-t2i-250415',
  40.00,
  JSON_ARRAY(
    '1024x1024', '864x1152', '1152x864', 
    '1280x720', '720x1280', '832x1248', 
    '1248x832', '1512x648'
  ),
  1000,
  '1024x1024',
  2.5,
  '一只可爱的猫咪在花园里玩耍，高清，细节丰富',
  'RobotOutlined',
  1,
  1
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  endpoint = VALUES(endpoint),
  model_id = VALUES(model_id);

-- 6. 修复已有数据中的错误路径（如果有）
UPDATE image_generations 
SET 
  local_path = REPLACE(local_path, '/../uploads/', '/uploads/'),
  thumbnail_path = REPLACE(thumbnail_path, '/../uploads/', '/uploads/')
WHERE local_path LIKE '/../uploads/%';

-- =====================================================
-- 迁移完成
-- =====================================================
