-- 2025年8月21日 - 添加HTML项目默认标识
-- 检查并添加is_default字段（如果不存在）
SET @dbname = DATABASE();
SET @tablename = 'html_projects';
SET @columnname = 'is_default';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
      AND table_name = @tablename
      AND column_name = @columnname
  ) > 0,
  'SELECT "is_default字段已存在";',
  'ALTER TABLE html_projects ADD COLUMN is_default TINYINT(1) DEFAULT 0 AFTER sort_order;'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 设置默认项目（如果存在）
UPDATE html_projects SET is_default = 1 WHERE name = '默认项目' AND is_default = 0;
