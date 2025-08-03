-- 016_add_system_prompts.sql
-- 添加系统级提示词功能

-- 1. 创建系统提示词表
CREATE TABLE IF NOT EXISTS system_prompts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '提示词名称',
    description TEXT COMMENT '提示词描述',
    content TEXT NOT NULL COMMENT '提示词内容',
    is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    created_by INT COMMENT '创建者ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_active (is_active),
    INDEX idx_sort (sort_order),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词表';

-- 2. 创建系统提示词与用户组的关联表
CREATE TABLE IF NOT EXISTS system_prompt_groups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    prompt_id INT NOT NULL,
    group_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_prompt_group (prompt_id, group_id),
    INDEX idx_group (group_id),
    FOREIGN KEY (prompt_id) REFERENCES system_prompts(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词分组权限表';

-- 3. 在对话表中添加系统提示词ID字段
ALTER TABLE conversations 
ADD COLUMN system_prompt_id INT DEFAULT NULL COMMENT '使用的系统提示词ID' AFTER system_prompt,
ADD INDEX idx_system_prompt_id (system_prompt_id),
ADD FOREIGN KEY (system_prompt_id) REFERENCES system_prompts(id) ON DELETE SET NULL;

-- 4. 在系统配置中添加系统提示词开关（使用现有的system_settings表）
INSERT INTO system_settings (setting_key, setting_value, setting_type, description) 
VALUES ('system_prompts_enabled', 'true', 'boolean', '是否启用系统级提示词功能')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
