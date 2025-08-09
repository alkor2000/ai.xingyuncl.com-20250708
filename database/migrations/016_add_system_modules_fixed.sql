-- 迁移脚本：添加系统内置模块支持
-- 时间：2024-12-10

-- 1. 检查并添加module_category字段
ALTER TABLE system_modules 
ADD COLUMN module_category ENUM('system', 'external') DEFAULT 'external' 
COMMENT '模块类别：system-系统内置，external-外部扩展' 
AFTER module_type;

-- 2. 添加can_disable字段
ALTER TABLE system_modules 
ADD COLUMN can_disable TINYINT(1) DEFAULT 1 
COMMENT '是否可以禁用：0-不可禁用（核心模块），1-可以禁用' 
AFTER is_active;

-- 3. 添加route_path字段
ALTER TABLE system_modules 
ADD COLUMN route_path VARCHAR(200) DEFAULT NULL 
COMMENT '系统模块的前端路由路径' 
AFTER module_url;

-- 4. 插入系统内置模块（使用INSERT IGNORE避免重复）
INSERT IGNORE INTO system_modules (
    name, display_name, description, module_type, module_category, 
    route_path, module_url, open_mode, menu_icon, proxy_path, auth_mode, 
    is_active, can_disable, sort_order, allowed_groups
) VALUES 
-- 工作台
('dashboard', '工作台', '系统工作台，显示概览信息', 'frontend', 'system', 
 '/', '/', 'iframe', 'DashboardOutlined', '/dashboard', 'none', 
 1, 1, 1, NULL),

-- 聊天
('chat', 'AI对话', 'AI智能对话功能', 'frontend', 'system', 
 '/chat', '/chat', 'iframe', 'MessageOutlined', '/chat', 'none', 
 1, 1, 2, NULL),

-- 万智台（知识库）
('knowledge', '万智台', '知识库管理系统', 'frontend', 'system', 
 '/knowledge', '/knowledge', 'iframe', 'AppstoreAddOutlined', '/knowledge', 'none', 
 1, 1, 3, NULL),

-- 用户管理
('admin_users', '用户管理', '用户和权限管理', 'frontend', 'system', 
 '/admin/users', '/admin/users', 'iframe', 'TeamOutlined', '/admin/users', 'none', 
 1, 0, 100, NULL),

-- 系统设置
('admin_settings', '系统设置', '系统配置管理', 'frontend', 'system', 
 '/admin/settings', '/admin/settings', 'iframe', 'SettingOutlined', '/admin/settings', 'none', 
 1, 0, 101, NULL);

-- 5. 更新现有外部模块的category
UPDATE system_modules 
SET module_category = 'external', can_disable = 1 
WHERE name IN ('html20250722', 'fg20250722', 'aihub20250722', 'image');

-- 6. 创建索引优化查询
ALTER TABLE system_modules ADD INDEX idx_category_active (module_category, is_active);
