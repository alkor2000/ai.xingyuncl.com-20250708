-- HTML编辑器模块迁移脚本
-- 创建时间：2025-08-18

-- 1. HTML项目/文件夹表
CREATE TABLE IF NOT EXISTS `html_projects` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `parent_id` BIGINT DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `path` VARCHAR(1000) DEFAULT NULL,
  `type` ENUM('folder', 'page') DEFAULT 'page',
  `description` TEXT,
  `tags` JSON DEFAULT NULL,
  `is_public` TINYINT(1) DEFAULT 0,
  `password` VARCHAR(255) DEFAULT NULL,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_type` (`type`),
  KEY `idx_is_public` (`is_public`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`parent_id`) REFERENCES `html_projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. HTML页面内容表
CREATE TABLE IF NOT EXISTS `html_pages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `html_content` LONGTEXT,
  `css_content` LONGTEXT,
  `js_content` LONGTEXT,
  `compiled_content` LONGTEXT,
  `version` INT DEFAULT 1,
  `is_published` TINYINT(1) DEFAULT 0,
  `publish_url` VARCHAR(500) DEFAULT NULL,
  `view_count` INT DEFAULT 0,
  `like_count` INT DEFAULT 0,
  `credits_consumed` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `published_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_slug` (`user_id`, `slug`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_slug` (`slug`),
  KEY `idx_is_published` (`is_published`),
  FOREIGN KEY (`project_id`) REFERENCES `html_projects`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. HTML资源文件表
CREATE TABLE IF NOT EXISTS `html_resources` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `project_id` BIGINT DEFAULT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `file_type` VARCHAR(50) NOT NULL,
  `file_size` BIGINT NOT NULL,
  `storage_type` ENUM('local', 'oss') DEFAULT 'local',
  `storage_path` VARCHAR(1000) NOT NULL,
  `oss_bucket` VARCHAR(255) DEFAULT NULL,
  `oss_key` VARCHAR(500) DEFAULT NULL,
  `cdn_url` VARCHAR(1000) DEFAULT NULL,
  `thumbnail_url` VARCHAR(1000) DEFAULT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `metadata` JSON DEFAULT NULL,
  `tags` JSON DEFAULT NULL,
  `description` TEXT,
  `download_count` INT DEFAULT 0,
  `bandwidth_used` BIGINT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_file_type` (`file_type`),
  KEY `idx_storage_type` (`storage_type`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`project_id`) REFERENCES `html_projects`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. HTML模板库表
CREATE TABLE IF NOT EXISTS `html_templates` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `thumbnail` VARCHAR(1000) DEFAULT NULL,
  `html_template` LONGTEXT,
  `css_template` LONGTEXT,
  `js_template` LONGTEXT,
  `description` TEXT,
  `tags` JSON DEFAULT NULL,
  `usage_count` INT DEFAULT 0,
  `is_premium` TINYINT(1) DEFAULT 0,
  `credits_required` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_is_premium` (`is_premium`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. OSS配置表（系统级配置）
CREATE TABLE IF NOT EXISTS `oss_config` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `provider` ENUM('aliyun', 'tencent', 'qiniu', 'aws', 'minio') NOT NULL,
  `access_key` VARCHAR(500) NOT NULL,
  `secret_key` VARCHAR(500) NOT NULL,
  `bucket_name` VARCHAR(255) NOT NULL,
  `region` VARCHAR(100) DEFAULT NULL,
  `endpoint` VARCHAR(500) DEFAULT NULL,
  `cdn_domain` VARCHAR(500) DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 0,
  `is_default` TINYINT(1) DEFAULT 0,
  `max_file_size_mb` INT DEFAULT 100,
  `allowed_file_types` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_provider` (`provider`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_is_default` (`is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. 在system_settings表中添加HTML编辑器配置
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `setting_type`, `description`) VALUES
('html_editor.enabled', 'true', 'boolean', 'HTML编辑器模块是否启用'),
('html_editor.credits_per_page', '10', 'number', '创建HTML页面消耗的积分'),
('html_editor.credits_per_update', '2', 'number', '更新HTML页面消耗的积分'),
('html_editor.max_pages_per_user', '100', 'number', '每个用户最多创建的页面数'),
('html_editor.max_file_size_mb', '10', 'number', '单个文件最大大小(MB)'),
('html_editor.storage_limit_mb', '1000', 'number', '每个用户的存储限制(MB)'),
('html_editor.enable_oss', 'false', 'boolean', '是否启用OSS存储'),
('html_editor.default_storage', 'local', 'string', '默认存储方式：local或oss')
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;

-- 7. 在system_modules表中注册HTML编辑器模块
INSERT INTO `system_modules` (
  `name`, 
  `display_name`, 
  `description`, 
  `module_type`, 
  `module_category`,
  `module_url`, 
  `route_path`, 
  `open_mode`, 
  `menu_icon`, 
  `proxy_path`, 
  `auth_mode`, 
  `is_active`, 
  `can_disable`, 
  `sort_order`
) VALUES (
  'html_editor',
  'HTML编辑器',
  '在线HTML/CSS/JS编辑器，支持文件管理和资源库',
  'frontend',
  'system',
  '/html-editor',
  '/html-editor',
  'iframe',
  'CodeOutlined',
  '/html_editor',
  'none',
  1,
  1,
  5
) ON DUPLICATE KEY UPDATE 
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `updated_at` = CURRENT_TIMESTAMP;

-- 8. 添加一些默认模板
INSERT INTO `html_templates` (`name`, `category`, `html_template`, `css_template`, `description`) VALUES
('空白页面', 'basic', '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>我的页面</title>\n</head>\n<body>\n    <h1>欢迎来到我的页面</h1>\n    <p>开始创建你的内容...</p>\n</body>\n</html>', 'body {\n    font-family: Arial, sans-serif;\n    margin: 0;\n    padding: 20px;\n    background-color: #f5f5f5;\n}\n\nh1 {\n    color: #333;\n}', '空白HTML页面模板'),
('个人主页', 'portfolio', '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>个人主页</title>\n</head>\n<body>\n    <header>\n        <h1>我的个人主页</h1>\n        <nav>\n            <a href="#about">关于我</a>\n            <a href="#projects">项目</a>\n            <a href="#contact">联系</a>\n        </nav>\n    </header>\n    <main>\n        <section id="about">\n            <h2>关于我</h2>\n            <p>在这里介绍你自己...</p>\n        </section>\n    </main>\n    <footer>\n        <p>&copy; 2025 我的网站</p>\n    </footer>\n</body>\n</html>', 'body {\n    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;\n    margin: 0;\n    padding: 0;\n    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n    color: white;\n}\n\nheader {\n    text-align: center;\n    padding: 50px 20px;\n}\n\nnav a {\n    color: white;\n    text-decoration: none;\n    margin: 0 15px;\n    font-size: 18px;\n}\n\nmain {\n    max-width: 1200px;\n    margin: 0 auto;\n    padding: 20px;\n}\n\nfooter {\n    text-align: center;\n    padding: 20px;\n    background: rgba(0,0,0,0.2);\n}', '个人主页模板，包含导航和基本布局');

-- 添加索引优化查询性能
ALTER TABLE `html_pages` ADD INDEX `idx_view_count` (`view_count`);
ALTER TABLE `html_pages` ADD INDEX `idx_created_at` (`created_at`);
ALTER TABLE `html_resources` ADD INDEX `idx_created_at` (`created_at`);

COMMIT;
