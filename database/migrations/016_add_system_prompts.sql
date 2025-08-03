-- 016_add_system_prompts.sql
-- 添加系统提示词功能相关表和字段

-- 1. 创建 schema_migrations 表（如果不存在）
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 删除旧的表结构（如果存在），以确保字段类型正确
DROP TABLE IF EXISTS system_prompt_groups;
DROP TABLE IF EXISTS system_prompts;

-- 3. 创建系统提示词表（使用正确的字段类型）
CREATE TABLE system_prompts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL COMMENT '提示词名称',
    description VARCHAR(200) COMMENT '提示词描述',
    content TEXT NOT NULL COMMENT '提示词内容',
    sort_order INT DEFAULT 0 COMMENT '排序顺序，越小越靠前',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_by BIGINT DEFAULT NULL COMMENT '创建人ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active_sort (is_active, sort_order),
    INDEX idx_created_at (created_at),
    INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词表';

-- 4. 创建系统提示词与用户组关联表（使用正确的字段类型）
CREATE TABLE system_prompt_groups (
    prompt_id INT NOT NULL COMMENT '提示词ID',
    group_id BIGINT NOT NULL COMMENT '用户组ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (prompt_id, group_id),
    INDEX idx_group_id (group_id),
    FOREIGN KEY (prompt_id) REFERENCES system_prompts(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词与用户组关联表';

-- 5. 在conversations表中添加system_prompt_id字段（如果不存在）
SET @column_exists = 0;
SELECT COUNT(*) INTO @column_exists 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
AND TABLE_NAME = 'conversations' 
AND COLUMN_NAME = 'system_prompt_id';

SET @sql = IF(@column_exists = 0,
    'ALTER TABLE conversations ADD COLUMN system_prompt_id INT DEFAULT NULL COMMENT ''使用的系统提示词ID'' AFTER system_prompt, ADD INDEX idx_system_prompt_id (system_prompt_id)',
    'SELECT ''Column system_prompt_id already exists''');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. 插入默认的系统提示词示例
INSERT INTO system_prompts (name, description, content, sort_order) VALUES
('通用助手', '友好、专业的AI助手，适合日常对话', '你是一个友好、专业的AI助手。请用清晰、准确的语言回答用户的问题，保持礼貌和耐心。如果遇到不确定的问题，请诚实地表达你的不确定性。', 10),
('技术专家', '专注于编程和技术问题解答', '你是一个经验丰富的技术专家，精通各种编程语言和技术栈。请用专业但易懂的方式解答技术问题，在必要时提供代码示例和最佳实践建议。注意代码的可读性和规范性。', 20),
('创意写作', '擅长创意写作和文案创作', '你是一个富有创造力的写作助手，擅长各种文体的创作。请根据用户的需求，创作引人入胜、富有想象力的内容。注意保持文字的流畅性和感染力。', 30),
('学习辅导', '耐心细致的学习辅导老师', '你是一位经验丰富、耐心细致的辅导老师。请用循序渐进的方式帮助学生理解知识点，适时提供例题和练习。鼓励学生思考，培养他们的学习兴趣。', 40),
('商务助理', '专业的商务沟通助手', '你是一位专业的商务助理，擅长撰写商务邮件、报告和提案。请使用正式、专业的语言，注意措辞的得体性和逻辑的严密性。在必要时提供商务礼仪建议。', 50);

-- 7. 将默认提示词设置为所有组可见
INSERT INTO system_prompt_groups (prompt_id, group_id)
SELECT sp.id, ug.id 
FROM system_prompts sp
CROSS JOIN user_groups ug
WHERE sp.is_active = 1;

-- 8. 在system_settings表中添加系统提示词功能开关
INSERT INTO system_settings (setting_key, setting_value) 
VALUES ('system_prompts_enabled', 'true')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

-- 9. 记录迁移版本
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('016_add_system_prompts', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
