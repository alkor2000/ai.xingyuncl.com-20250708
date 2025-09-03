-- 迁移脚本 039: 为messages表添加generated_images字段
-- 用于存储AI生成的图片信息
-- 执行时间: 2025-09-03

-- 检查字段是否已存在，避免重复添加
SET @dbname = DATABASE();
SET @tablename = 'messages';
SET @columnname = 'generated_images';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname
   AND TABLE_NAME = @tablename
   AND COLUMN_NAME = @columnname) > 0,
  'SELECT "字段generated_images已存在，跳过添加" AS message;',
  'ALTER TABLE messages ADD COLUMN generated_images JSON DEFAULT NULL COMMENT "生成的图片信息" AFTER file_id;'
));

PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 记录迁移
INSERT INTO migrations_history (version, description, executed_at) 
VALUES ('039', '添加messages.generated_images字段支持图片生成', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
