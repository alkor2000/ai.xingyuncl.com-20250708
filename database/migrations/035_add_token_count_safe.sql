-- 035_add_token_count_to_modules.sql
-- 安全版本：检查字段是否存在再添加

-- 检查并添加token_count字段
SET @dbname = DATABASE();
SET @tablename = 'knowledge_modules';
SET @columnname = 'token_count';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = @dbname
      AND table_name = @tablename
      AND column_name = @columnname
  ) > 0,
  'SELECT "token_count字段已存在";',
  'ALTER TABLE knowledge_modules ADD COLUMN token_count INT DEFAULT 0 COMMENT ''Token数量估算'' AFTER content;'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 更新token_count值（只更新为0的记录）
UPDATE knowledge_modules 
SET token_count = CASE
    WHEN LENGTH(content) != CHAR_LENGTH(content) THEN CEIL(CHAR_LENGTH(content) * 1.5)
    ELSE CEIL(LENGTH(content) / 4)
END
WHERE token_count = 0;
