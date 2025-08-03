-- 020_fix_system_prompts_structure.sql
-- 修复系统提示词相关的数据库结构

-- 添加 created_by 字段到 system_prompts 表
SET @column_exists = 0;
SELECT COUNT(*) INTO @column_exists 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
AND TABLE_NAME = 'system_prompts' 
AND COLUMN_NAME = 'created_by';

SET @sql = IF(@column_exists = 0,
    'ALTER TABLE system_prompts ADD COLUMN created_by INT DEFAULT NULL COMMENT ''创建人ID'' AFTER is_active, ADD INDEX idx_created_by (created_by)',
    'SELECT ''Column created_by already exists''');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 创建 system_prompt_groups 关联表
CREATE TABLE IF NOT EXISTS system_prompt_groups (
    prompt_id INT NOT NULL COMMENT '提示词ID',
    group_id INT NOT NULL COMMENT '用户组ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (prompt_id, group_id),
    INDEX idx_group_id (group_id),
    FOREIGN KEY (prompt_id) REFERENCES system_prompts(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词与用户组关联表';

-- 将现有提示词设置为所有组可见（如果表是新创建的）
INSERT INTO system_prompt_groups (prompt_id, group_id)
SELECT sp.id, ug.id 
FROM system_prompts sp
CROSS JOIN user_groups ug
WHERE NOT EXISTS (
    SELECT 1 FROM system_prompt_groups spg 
    WHERE spg.prompt_id = sp.id AND spg.group_id = ug.id
);

-- 记录迁移版本
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('020_fix_system_prompts_structure', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
