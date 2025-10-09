-- ============================================
-- Sora 2 视频生成支持（MySQL兼容版本）
-- ============================================

-- 检查并添加 provider 字段
SET @dbname = DATABASE();
SET @tablename = 'video_generations';
SET @columnname = 'provider';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'provider列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN provider VARCHAR(50) DEFAULT 'kling' COMMENT '视频提供商: kling, sora2_goapi';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 orientation 字段
SET @columnname = 'orientation';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'orientation列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN orientation VARCHAR(20) COMMENT '方向: portrait, landscape, square';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 reference_images 字段
SET @columnname = 'reference_images';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'reference_images列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN reference_images TEXT COMMENT '参考图片URL列表(JSON)';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 generation_id 字段
SET @columnname = 'generation_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'generation_id列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN generation_id VARCHAR(100) COMMENT '生成ID(如 gen_xxx)';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 oss_video_url 字段
SET @columnname = 'oss_video_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'oss_video_url列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN oss_video_url VARCHAR(500) COMMENT 'OSS存储的视频URL';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 oss_thumbnail_url 字段
SET @columnname = 'oss_thumbnail_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'oss_thumbnail_url列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN oss_thumbnail_url VARCHAR(500) COMMENT 'OSS存储的缩略图URL';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 oss_gif_url 字段
SET @columnname = 'oss_gif_url';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'oss_gif_url列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN oss_gif_url VARCHAR(500) COMMENT 'OSS存储的GIF预览URL';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 raw_response 字段
SET @columnname = 'raw_response';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'raw_response列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN raw_response LONGTEXT COMMENT '原始API响应JSON';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 started_at 字段
SET @columnname = 'started_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'started_at列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN started_at TIMESTAMP NULL COMMENT '开始生成时间';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 completed_at 字段
SET @columnname = 'completed_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'completed_at列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN completed_at TIMESTAMP NULL COMMENT '完成时间';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 download_attempted 字段
SET @columnname = 'download_attempted';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'download_attempted列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN download_attempted BOOLEAN DEFAULT FALSE COMMENT '是否尝试过下载到OSS';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 download_failed_reason 字段
SET @columnname = 'download_failed_reason';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE (table_name = @tablename)
   AND (table_schema = @dbname)
   AND (column_name = @columnname)) > 0,
  "SELECT 'download_failed_reason列已存在' as info;",
  "ALTER TABLE video_generations ADD COLUMN download_failed_reason TEXT COMMENT 'OSS下载失败原因';"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 添加索引（忽略已存在的索引错误）
ALTER TABLE video_generations ADD INDEX idx_provider_status (provider, status);
ALTER TABLE video_generations ADD INDEX idx_generation_id (generation_id);
ALTER TABLE video_generations ADD INDEX idx_download_attempted (download_attempted, status);

-- 更新已有数据的provider字段
UPDATE video_generations 
SET provider = 'kling' 
WHERE provider IS NULL OR provider = '';

-- 插入系统配置（使用INSERT IGNORE避免重复）
INSERT IGNORE INTO system_config (config_key, config_value, config_type, description, created_at, updated_at)
VALUES 
  ('video.sora2.enabled', 'false', 'boolean', 'Sora 2 视频生成是否启用', NOW(), NOW()),
  ('video.sora2.api_key', '', 'string', 'Sora 2 API密钥（加密存储）', NOW(), NOW()),
  ('video.sora2.api_base_url', 'https://goapi.gptnb.ai', 'string', 'Sora 2 API基础URL', NOW(), NOW()),
  ('video.sora2.credits.portrait_4s', '100', 'integer', 'Sora 2 竖屏4秒视频积分消耗', NOW(), NOW()),
  ('video.sora2.credits.landscape_4s', '100', 'integer', 'Sora 2 横屏4秒视频积分消耗', NOW(), NOW()),
  ('video.sora2.credits.portrait_8s', '200', 'integer', 'Sora 2 竖屏8秒视频积分消耗', NOW(), NOW()),
  ('video.sora2.credits.landscape_8s', '200', 'integer', 'Sora 2 横屏8秒视频积分消耗', NOW(), NOW()),
  ('video.sora2.credits.with_image', '50', 'integer', 'Sora 2 使用图片参考额外积分', NOW(), NOW()),
  ('video.auto_download_to_oss', 'true', 'boolean', '视频完成后自动下载到OSS', NOW(), NOW()),
  ('video.download_gif_preview', 'true', 'boolean', '是否下载GIF预览', NOW(), NOW()),
  ('video.sync_interval', '30', 'integer', '后端任务同步间隔（秒）', NOW(), NOW()),
  ('video.sync_max_age', '86400', 'integer', '同步任务的最大年龄（秒，默认24小时）', NOW(), NOW());

-- 更新交易类型枚举
ALTER TABLE credit_transactions 
  MODIFY COLUMN transaction_type ENUM(
    'recharge',
    'consume', 
    'refund',
    'admin_adjust',
    'admin_add',
    'admin_deduct',
    'admin_set',
    'chat_consume',
    'image_consume',
    'video_consume',
    'video_refund',
    'html_publish',
    'html_unpublish_refund',
    'storage_consume',
    'mindmap_consume',
    'ocr_consume'
  ) NOT NULL COMMENT '交易类型';

-- 完成提示
SELECT '✅ Sora 2 视频支持迁移完成！' as status;
