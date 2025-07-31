-- 为用户组添加站点自定义配置功能
ALTER TABLE user_groups 
ADD COLUMN site_customization_enabled BOOLEAN DEFAULT FALSE COMMENT '是否允许自定义站点配置',
ADD COLUMN site_name VARCHAR(255) DEFAULT NULL COMMENT '组站点名称',
ADD COLUMN site_logo VARCHAR(500) DEFAULT NULL COMMENT '组站点logo URL',
ADD INDEX idx_site_customization (site_customization_enabled);

-- 添加注释
ALTER TABLE user_groups COMMENT '用户分组表（支持独立站点配置）';
