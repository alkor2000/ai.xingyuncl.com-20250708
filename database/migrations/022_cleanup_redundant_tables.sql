-- 022_cleanup_redundant_tables.sql
-- 清理冗余表和优化表结构
-- 执行时间：2025-08-05

-- 1. 删除冗余的备份表和空表
DROP TABLE IF EXISTS combination_modules_backup_20250805;
DROP TABLE IF EXISTS combination_modules;

-- 2. 添加索引（先检查是否存在）
-- 使用存储过程来安全地添加索引
DELIMITER $$
DROP PROCEDURE IF EXISTS add_index_if_not_exists$$
CREATE PROCEDURE add_index_if_not_exists()
BEGIN
    DECLARE index_exists INT DEFAULT 0;
    
    SELECT COUNT(*) INTO index_exists
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'module_combination_items'
    AND index_name = 'idx_combination_order';
    
    IF index_exists = 0 THEN
        ALTER TABLE module_combination_items 
        ADD INDEX idx_combination_order (combination_id, order_index);
    END IF;
END$$
DELIMITER ;

CALL add_index_if_not_exists();
DROP PROCEDURE add_index_if_not_exists;

-- 3. 更新表注释
ALTER TABLE module_combination_items COMMENT '模块组合项关联表';
ALTER TABLE module_combinations COMMENT '模块组合表';
ALTER TABLE knowledge_modules COMMENT '知识模块表';

-- 4. 创建迁移历史表（如果不存在）
CREATE TABLE IF NOT EXISTS migrations_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库迁移历史';

-- 5. 记录迁移
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('022_cleanup_redundant_tables', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
