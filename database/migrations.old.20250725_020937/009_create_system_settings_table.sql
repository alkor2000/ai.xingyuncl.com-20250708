-- 系统配置表
-- 用于存储站点名称、Logo等全局配置

CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL COMMENT '配置键',
    setting_value TEXT NULL COMMENT '配置值（JSON格式）',
    setting_type VARCHAR(50) DEFAULT 'string' COMMENT '配置类型',
    description VARCHAR(255) NULL COMMENT '配置说明',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- 插入默认配置
INSERT INTO system_settings (setting_key, setting_value, setting_type, description) VALUES
('site_config', '{"name":"AI Platform","description":"企业级AI应用聚合平台","logo":"","favicon":""}', 'json', '站点基础配置'),
('user_config', '{"allow_register":true,"default_token_quota":10000,"default_group_id":1,"default_credits_quota":1000}', 'json', '用户默认配置'),
('ai_config', '{"default_model":"gpt-4.1-mini-op","temperature":0.0}', 'json', 'AI默认配置'),
('credits_config', '{"default_credits":1000,"max_credits":100000,"min_credits_for_chat":1}', 'json', '积分系统配置');

-- 创建完成提示
SELECT 'System settings table created successfully!' AS message;
