-- =====================================================
-- Migration: 028_system_modules_production_fix
-- Date: 2025-08-11
-- Description: 为生产环境添加module_category字段
-- =====================================================

-- 1. 添加module_category字段（生产环境没有这个字段）
ALTER TABLE system_modules 
ADD COLUMN module_category ENUM('system', 'external') DEFAULT 'external' AFTER module_type;

-- 2. 添加route_path字段（如果不存在）
ALTER TABLE system_modules 
ADD COLUMN route_path VARCHAR(200) DEFAULT NULL AFTER module_url;

-- 3. 添加can_disable字段（如果不存在）
ALTER TABLE system_modules 
ADD COLUMN can_disable TINYINT(1) DEFAULT 1 AFTER is_active;

-- 4. 修改proxy_path允许NULL（避免插入错误）
ALTER TABLE system_modules 
MODIFY COLUMN proxy_path VARCHAR(100) DEFAULT NULL;

-- 5. 设置正确的module_category和排序
UPDATE system_modules SET
    module_category = 'external',  -- 默认都是external
    sort_order = 0
WHERE 1=1;

-- 特定模块设置为system
UPDATE system_modules SET module_category = 'system' 
WHERE name IN ('dashboard', 'chat', 'knowledge', 'image_generation', 'admin_users', 'admin_settings', 'image');

-- 6. 设置正确的排序
UPDATE system_modules SET sort_order = CASE name
    WHEN 'dashboard' THEN 1
    WHEN 'aihub20250722' THEN 1  -- 如果存在，也设为1
    WHEN 'chat' THEN 2
    WHEN 'html20250722' THEN 2   -- 如果存在，也设为2
    WHEN 'knowledge' THEN 3
    WHEN 'fg20250722' THEN 3      -- 如果存在，也设为3
    WHEN 'image_generation' THEN 35
    WHEN 'image' THEN 35          -- 图像生成
    WHEN 'admin_users' THEN 100
    WHEN 'admin_settings' THEN 101
    ELSE 0
END;

-- 7. 设置route_path
UPDATE system_modules SET route_path = CASE name
    WHEN 'dashboard' THEN '/'
    WHEN 'aihub20250722' THEN '/dashboard'
    WHEN 'chat' THEN '/chat'
    WHEN 'html20250722' THEN '/chat'
    WHEN 'knowledge' THEN '/knowledge'
    WHEN 'fg20250722' THEN '/knowledge'
    WHEN 'image_generation' THEN '/image'
    WHEN 'image' THEN '/image'
    WHEN 'admin_users' THEN '/admin/users'
    WHEN 'admin_settings' THEN '/admin/settings'
    ELSE route_path
END;

-- 8. 确保必要的菜单存在（INSERT IGNORE避免重复）
INSERT IGNORE INTO system_modules (name, display_name, module_category, module_type, route_path, menu_icon, is_active, sort_order) VALUES
('dashboard', '工作台', 'system', 'frontend', '/', 'DashboardOutlined', 1, 1),
('chat', 'AI对话', 'system', 'frontend', '/chat', 'MessageOutlined', 1, 2),
('knowledge', '万智台', 'system', 'frontend', '/knowledge', 'BookOutlined', 1, 3),
('image_generation', 'AI绘画', 'system', 'frontend', '/image', 'PictureOutlined', 1, 35),
('admin_users', '用户管理', 'system', 'frontend', '/admin/users', 'UserOutlined', 1, 100),
('admin_settings', '系统设置', 'system', 'frontend', '/admin/settings', 'SettingOutlined', 1, 101);

-- 记录迁移
INSERT IGNORE INTO schema_migrations (version, executed_at) 
VALUES ('028_system_modules_production_fix', NOW());

-- 验证结果
SELECT '迁移完成' as status;
SELECT name, display_name, module_category, sort_order, route_path 
FROM system_modules 
WHERE is_active = 1 
ORDER BY sort_order, id;
