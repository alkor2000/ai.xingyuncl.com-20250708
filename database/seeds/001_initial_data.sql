-- AI Platform 初始数据
-- 创建超级管理员和基础配置数据
-- 更新时间: 2025-01-12 (新增流式输出支持)

-- 1. 创建超级管理员用户
-- 密码: admin123 (bcrypt hash)
INSERT INTO users (email, username, password_hash, role, status, token_quota) VALUES
('admin@ai.xingyuncl.com', 'superadmin', '\\$2a\\$12$LQv3c1yqBw100dQyTOJ/PeBnf1TJIb.N5J97UVc.wXd6QYgbPSmvC', 'super_admin', 'active', 1000000);

-- 获取超级管理员ID（用于后续权限设置）
SET @super_admin_id = LAST_INSERT_ID();

-- 2. 设置超级管理员权限
INSERT INTO permissions (user_id, permission_type) VALUES
(@super_admin_id, 'system.all'),
(@super_admin_id, 'user.manage'),
(@super_admin_id, 'admin.manage'),
(@super_admin_id, 'chat.unlimited'),
(@super_admin_id, 'file.unlimited'),
(@super_admin_id, 'stats.view');

-- 3. 插入默认AI模型配置 (默认启用流式输出)
INSERT INTO ai_models (name, display_name, provider, model_config, stream_enabled, is_active, sort_order) VALUES
('gpt-3.5-turbo', 'GPT-3.5 Turbo', 'openai', JSON_OBJECT('temperature', 0.7), true, true, 1),
('gpt-4', 'GPT-4', 'openai', JSON_OBJECT('temperature', 0.7), true, true, 2),
('gpt-4-turbo', 'GPT-4 Turbo', 'openai', JSON_OBJECT('temperature', 0.7), true, true, 3),
('claude-3-haiku', 'Claude 3 Haiku', 'anthropic', JSON_OBJECT('temperature', 0.7), true, true, 4),
('claude-3-sonnet', 'Claude 3 Sonnet', 'anthropic', JSON_OBJECT('temperature', 0.7), true, true, 5),
('claude-3-opus', 'Claude 3 Opus', 'anthropic', JSON_OBJECT('temperature', 0.7), true, true, 6);

-- 4. 创建示例普通用户（可选）
INSERT INTO users (email, username, password_hash, role, status, token_quota) VALUES
('user@example.com', 'testuser', '\\$2a\\$12$LQv3c1yqBw100dQyTOJ/PeBnf1TJIb.N5J97UVc.wXd6QYgbPSmvC', 'user', 'active', 10000);

-- 获取普通用户ID
SET @test_user_id = LAST_INSERT_ID();

-- 5. 设置普通用户基础权限
INSERT INTO permissions (user_id, permission_type) VALUES
(@test_user_id, 'chat.use'),
(@test_user_id, 'file.upload');

-- 初始化完成提示
SELECT 'AI Platform 初始数据插入完成！' AS message,
       'Super Admin: admin@ai.xingyuncl.com / admin123' AS admin_info,
       'Test User: user@example.com / admin123' AS user_info,
       'Stream Feature: 所有AI模型默认启用流式输出' AS stream_info;
