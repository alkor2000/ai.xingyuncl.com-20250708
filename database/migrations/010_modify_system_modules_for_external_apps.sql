-- 修改system_modules表以支持外部应用集成
-- 添加新字段来支持简单的外部网站集成

-- 添加模块URL字段（外部应用的访问地址）
ALTER TABLE system_modules 
ADD COLUMN module_url VARCHAR(1000) DEFAULT NULL COMMENT '模块访问URL' AFTER frontend_url;

-- 添加打开方式字段
ALTER TABLE system_modules 
ADD COLUMN open_mode ENUM('iframe', 'new_tab') DEFAULT 'new_tab' COMMENT '打开方式：iframe嵌入或新标签页' AFTER module_url;

-- 添加菜单图标字段
ALTER TABLE system_modules 
ADD COLUMN menu_icon VARCHAR(50) DEFAULT 'AppstoreOutlined' COMMENT '菜单图标（Ant Design图标名称）' AFTER open_mode;

-- 添加允许访问的用户组（JSON数组格式）
ALTER TABLE system_modules 
ADD COLUMN allowed_groups JSON DEFAULT NULL COMMENT '允许访问的用户组ID列表' AFTER permissions;

-- 添加索引以提高查询性能
ALTER TABLE system_modules ADD INDEX idx_active_sort (is_active, sort_order);

-- 更新现有数据，将module_url设置为frontend_url或api_endpoint
UPDATE system_modules 
SET module_url = COALESCE(frontend_url, api_endpoint) 
WHERE module_url IS NULL;

-- 添加注释说明
ALTER TABLE system_modules COMMENT = '系统模块配置表 - 支持外部应用集成';
