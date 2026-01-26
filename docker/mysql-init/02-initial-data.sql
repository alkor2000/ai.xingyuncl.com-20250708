-- =====================================================
-- AI Practice Platform - Initial Data (Complete Version)
-- Run after 01-complete-database-structure.sql
-- Default admin: admin / Admin@123456
-- Updated: 2026-01-26
-- =====================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================
-- 1. Default User Group
-- =====================================================
INSERT INTO `user_groups` (`id`, `name`, `description`, `color`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
(1, 'Default', 'Default user group', '#1890ff', 1, 0, NOW(), NOW());

-- =====================================================
-- 2. Admin User (password: Admin@123456)
-- =====================================================
INSERT INTO `users` (`id`, `uuid`, `username`, `email`, `password_hash`, `role`, `group_id`, `status`, `credits_quota`, `used_credits`, `created_at`, `updated_at`) VALUES
(1, UUID(), 'admin', 'admin@example.com', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe0JhbNFrdOTkG8d0LULZ0Z4Qq.i', 'super_admin', 1, 'active', 999999, 0, NOW(), NOW());

-- =====================================================
-- 3. System Settings (Essential Configuration)
-- =====================================================
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `created_at`, `updated_at`) VALUES
('site_config', '{"name":"AI Practice Platform","logo":"","description":"AI Application and Practice Platform"}', NOW(), NOW()),
('system_announcement', '{"content":"Welcome to AI Practice Platform!\\n\\nPlease configure your AI models in Settings > AI Models."}', NOW(), NOW()),
('user_config', '{"allow_register":true,"require_invitation_code":false,"default_tokens":120000000,"default_credits":1000}', NOW(), NOW()),
('credits_config', '{"default_credits":1000,"min_credits_for_chat":1}', NOW(), NOW()),
('login_config', '{"mode":"standard","refresh_token_days":30}', NOW(), NOW()),
('system_prompts_enabled', 'true', NOW(), NOW()),
('knowledge_module_enabled', 'true', NOW(), NOW()),
('knowledge_module_name', 'Knowledge Cube', NOW(), NOW()),
('ai_config', '{"default_model":"","temperature":0.7}', NOW(), NOW()),
('chat_config', '{"font_family":"system-ui, -apple-system, sans-serif","font_size":16}', NOW(), NOW()),
('html_editor.enabled', 'true', NOW(), NOW()),
('html_editor.credits_per_page', '1', NOW(), NOW()),
('html_editor.credits_per_update', '0', NOW(), NOW()),
('html_editor.credits_per_publish', '1', NOW(), NOW()),
('html_editor.max_pages_per_user', '100', NOW(), NOW()),
('html_editor.max_file_size_mb', '10', NOW(), NOW()),
('html_editor.storage_limit_mb', '50', NOW(), NOW()),
('html_editor.default_storage', 'local', NOW(), NOW()),
('html_editor.enable_oss', 'false', NOW(), NOW()),
('mindmap.save_credits', '0', NOW(), NOW()),
('mindmap.export_svg_credits', '1', NOW(), NOW()),
('mindmap.export_png_credits', '1', NOW(), NOW()),
('mindmap.export_pdf_credits', '1', NOW(), NOW()),
('mindmap.export_markdown_credits', '1', NOW(), NOW()),
('ocr.enabled', 'true', NOW(), NOW()),
('ocr.credits_per_image', '1', NOW(), NOW()),
('ocr.credits_per_pdf_page', '1', NOW(), NOW()),
('ocr.max_file_size_mb', '50', NOW(), NOW()),
('ocr.max_pdf_pages', '200', NOW(), NOW()),
('ocr.mistral_model', 'mistral-ocr-latest', NOW(), NOW()),
('midjourney_polling_enabled', 'true', NOW(), NOW()),
('midjourney_polling_interval', '2000', NOW(), NOW()),
('midjourney_max_polling_time', '300000', NOW(), NOW()),
('rate_limit_config', '{"auth":{"windowMs":900000,"max":200,"enabled":false},"emailCode":{"windowMs":60000,"max":1,"enabled":false},"global":{"windowMs":900000,"max":2000,"enabled":false},"adminRead":{"windowMs":60000,"max":200,"enabled":false},"adminWrite":{"windowMs":60000,"max":50,"enabled":false}}', NOW(), NOW()),
('theme_config', '{"preset":"default","custom":{"primaryColor":"#1677ff","successColor":"#52c41a","warningColor":"#faad14","errorColor":"#ff4d4f"}}', NOW(), NOW());

-- =====================================================
-- 4. System Modules (Sidebar Navigation)
-- =====================================================
INSERT INTO `system_modules` (`id`, `name`, `display_name`, `description`, `module_type`, `module_category`, `module_url`, `route_path`, `open_mode`, `menu_icon`, `proxy_path`, `auth_mode`, `is_active`, `can_disable`, `sort_order`, `created_at`, `updated_at`) VALUES
(1, 'dashboard', 'Dashboard', 'System dashboard with overview information', 'frontend', 'system', '/', '/', 'iframe', 'DashboardOutlined', '/dashboard', 'none', 1, 1, 1, NOW(), NOW()),
(2, 'chat', 'AI Chat', 'AI intelligent conversation', 'frontend', 'system', '/chat', '/chat', 'iframe', 'MessageOutlined', '/chat', 'none', 1, 1, 10, NOW(), NOW()),
(3, 'smart_apps', 'Smart Apps', 'Pre-configured AI applications', 'frontend', 'system', NULL, '/smart-apps', 'new_tab', 'ReadOutlined', '/smart-apps', 'jwt', 1, 1, 15, NOW(), NOW()),
(4, 'knowledge', 'Knowledge Cube', 'Knowledge module management', 'frontend', 'system', '/knowledge', '/knowledge', 'iframe', 'AppstoreAddOutlined', '/knowledge', 'none', 1, 1, 30, NOW(), NOW()),
(5, 'wiki', 'Wiki', 'Personal and team knowledge management', 'fullstack', 'system', NULL, '/wiki', 'new_tab', 'BookOutlined', '/api/wiki', 'jwt', 1, 1, 35, NOW(), NOW()),
(6, 'html_editor', 'HTML Editor', 'Online HTML/CSS/JS editor', 'frontend', 'system', '/html-editor', '/html-editor', 'iframe', 'GlobalOutlined', '/html_editor', 'none', 1, 1, 40, NOW(), NOW()),
(7, 'calendar', 'AI Calendar', 'AI-powered calendar with smart analysis', 'fullstack', 'system', NULL, '/calendar', 'iframe', 'CalendarOutlined', '/calendar', 'jwt', 1, 1, 45, NOW(), NOW()),
(8, 'image_generation', 'Image Generation', 'AI image generation', 'frontend', 'system', '/image', '/image', 'iframe', 'PictureOutlined', '/image', 'none', 1, 1, 50, NOW(), NOW()),
(9, 'agent', 'Agent Workflow', 'Visual workflow editor', 'fullstack', 'system', NULL, '/agent', 'iframe', 'ApartmentOutlined', '/agent', 'jwt', 1, 1, 55, NOW(), NOW()),
(10, 'video_generation', 'Video Generation', 'AI video generation', 'frontend', 'system', '/video', '/video', 'iframe', 'VideoCameraOutlined', '/video', 'none', 1, 1, 60, NOW(), NOW()),
(11, 'storage', 'Cloud Storage', 'Cloud file storage management', 'frontend', 'system', NULL, '/storage', 'new_tab', 'CloudOutlined', '/storage-proxy', 'jwt', 1, 1, 70, NOW(), NOW()),
(12, 'mindmap', 'Mind Map', 'Markdown mind map editor', 'fullstack', 'system', NULL, '/mindmap', 'iframe', 'PartitionOutlined', '/mindmap', 'none', 1, 1, 80, NOW(), NOW()),
(13, 'ocr', 'OCR', 'Image and PDF text recognition', 'fullstack', 'system', NULL, '/ocr', 'new_tab', 'ScanOutlined', '/api/ocr', 'jwt', 1, 1, 90, NOW(), NOW()),
(14, 'teaching', 'Teaching', 'Teaching module management system', 'fullstack', 'system', NULL, '/teaching', 'iframe', 'TeamOutlined', 'teaching', 'jwt', 1, 1, 95, NOW(), NOW()),
(15, 'admin_users', 'User Management', 'User and permission management', 'frontend', 'system', '/admin/users', '/admin/users', 'iframe', 'TeamOutlined', '/admin/users', 'none', 1, 0, 100, NOW(), NOW()),
(16, 'admin_settings', 'Settings', 'System configuration', 'frontend', 'system', '/admin/settings', '/admin/settings', 'iframe', 'SettingOutlined', '/admin/settings', 'none', 1, 0, 101, NOW(), NOW());

-- =====================================================
-- 5. Calendar Categories (System Presets)
-- =====================================================
INSERT INTO `calendar_categories` (`id`, `user_id`, `name`, `color`, `icon`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
(1, NULL, 'Study', '#52c41a', 'BookOutlined', 1, 1, NOW(), NOW()),
(2, NULL, 'Work', '#1890ff', 'LaptopOutlined', 1, 2, NOW(), NOW()),
(3, NULL, 'Life', '#fa8c16', 'HomeOutlined', 1, 3, NOW(), NOW()),
(4, NULL, 'Other', '#8c8c8c', 'TagOutlined', 1, 4, NOW(), NOW());

-- =====================================================
-- 6. Calendar Prompt Templates
-- =====================================================
INSERT INTO `calendar_prompt_templates` (`id`, `name`, `prompt`, `description`, `is_default`, `display_order`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'Quick Analysis Template', 'You are a professional time management consultant and schedule planning expert.\n\n[Current Time] {today} {currentDateTime} ({currentWeekday})\n[Analysis Range] {scanDateStart} to {scanDateEnd}\n[Total Events] {eventsCount}\n\n[Event Details]\n{eventsData}\n\n[Statistics]\n- Categories: {categoryDistribution}\n- Status: {statusDistribution}\n- Importance: {importanceDistribution}\n\nBased on today being {today}, analyze the user schedule and provide:\n\n1. Urgent and Important Reminders\n2. Upcoming Focus Areas\n3. Overall Analysis and Recommendations\n\nKeep your response under 150 words.', 'Quick time management analysis with time awareness', 1, 1, 1, NOW(), NOW()),
(2, 'Deep Analysis Template', 'You are a time management expert. Please analyze the {eventsCount} calendar events from {scanDateStart} to {scanDateEnd}, providing priority ranking, time allocation suggestions, conflict detection, and efficiency optimization recommendations.\n\nKeep your response under 500 words.', 'Comprehensive time management analysis', 0, 2, 1, NOW(), NOW());

-- =====================================================
-- 7. Smart App Categories
-- =====================================================
INSERT INTO `smart_app_categories` (`id`, `name`, `color`, `icon`, `sort_order`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'Writing Assistant', '#1677ff', 'EditOutlined', 1, 1, NOW(), NOW()),
(2, 'Programming', '#52c41a', 'CodeOutlined', 2, 1, NOW(), NOW()),
(3, 'Education', '#722ed1', 'BookOutlined', 0, 1, NOW(), NOW()),
(4, 'Productivity', '#fa8c16', 'ScheduleOutlined', 4, 1, NOW(), NOW()),
(5, 'Creative Design', '#eb2f96', 'BulbOutlined', 5, 1, NOW(), NOW()),
(6, 'Other', '#8c8c8c', 'AppstoreOutlined', 99, 1, NOW(), NOW());

-- =====================================================
-- 8. Agent Node Types
-- =====================================================
INSERT INTO `agent_node_types` (`id`, `type_key`, `name`, `description`, `category`, `config_schema`, `is_active`, `credits_per_execution`, `max_inputs`, `max_outputs`, `display_order`, `created_at`, `updated_at`) VALUES
(1, 'start', 'Start', 'Workflow start node - receives user input', 'input', '{}', 1, 0, 0, 1, 1, NOW(), NOW()),
(2, 'llm', 'AI Chat', 'Large Language Model node for AI conversation', 'process', '{}', 1, 10, 1, 1, 2, NOW(), NOW()),
(3, 'knowledge', 'Knowledge Retrieval', 'Knowledge base retrieval node', 'process', '{}', 1, 5, 1, 1, 3, NOW(), NOW()),
(4, 'end', 'End', 'Workflow end node - outputs final result', 'output', '{}', 1, 0, 1, 0, 4, NOW(), NOW()),
(5, 'classifier', 'Question Classifier', 'AI-powered question classification node', 'control', '{}', 1, 5, 1, 10, 5, NOW(), NOW());

-- =====================================================
-- 9. HTML Templates
-- =====================================================
INSERT INTO `html_templates` (`id`, `name`, `category`, `html_template`, `css_template`, `js_template`, `description`, `usage_count`, `is_premium`, `credits_required`, `created_at`, `updated_at`) VALUES
(1, 'Blank Page', 'basic', '<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>My Page</title>\n</head>\n<body>\n    <h1>Welcome to My Page</h1>\n    <p>Start creating your content...</p>\n</body>\n</html>', 'body {\n    font-family: Arial, sans-serif;\n    margin: 0;\n    padding: 20px;\n    background-color: #f5f5f5;\n}\n\nh1 {\n    color: #333;\n}', NULL, 'Blank HTML page template', 0, 0, 0, NOW(), NOW()),
(2, 'Personal Homepage', 'portfolio', '<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Personal Homepage</title>\n</head>\n<body>\n    <header>\n        <h1>My Personal Homepage</h1>\n        <nav>\n            <a href=\"#about\">About</a>\n            <a href=\"#projects\">Projects</a>\n            <a href=\"#contact\">Contact</a>\n        </nav>\n    </header>\n    <main>\n        <section id=\"about\">\n            <h2>About Me</h2>\n            <p>Introduce yourself here...</p>\n        </section>\n    </main>\n    <footer>\n        <p>2025 My Website</p>\n    </footer>\n</body>\n</html>', 'body {\n    font-family: Segoe UI, Tahoma, Geneva, Verdana, sans-serif;\n    margin: 0;\n    padding: 0;\n    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n    color: white;\n}\n\nheader {\n    text-align: center;\n    padding: 50px 20px;\n}\n\nnav a {\n    color: white;\n    text-decoration: none;\n    margin: 0 15px;\n    font-size: 18px;\n}\n\nmain {\n    max-width: 1200px;\n    margin: 0 auto;\n    padding: 20px;\n}\n\nfooter {\n    text-align: center;\n    padding: 20px;\n    background: rgba(0,0,0,0.2);\n}', NULL, 'Personal homepage template with navigation and basic layout', 0, 0, 0, NOW(), NOW());

-- =====================================================
-- 10. Calendar Config
-- =====================================================
INSERT INTO `calendar_config` (`id`, `credits_multiplier`, `created_at`, `updated_at`) VALUES
(1, 1.0, NOW(), NOW());

-- =====================================================
-- 11. Sample AI Model (disabled by default)
-- =====================================================
INSERT INTO `ai_models` (`id`, `name`, `display_name`, `provider`, `api_endpoint`, `api_key`, `model_config`, `stream_enabled`, `image_upload_enabled`, `credits_per_chat`, `is_active`, `is_public`, `sort_order`, `created_at`, `updated_at`) VALUES
(1, 'deepseek-chat', 'DeepSeek V3 (Configure API Key)', 'deepseek', 'https://api.deepseek.com/v1', '', '{}', 1, 0, 2, 0, 1, 1, NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- POST-INSTALLATION CHECKLIST:
-- 1. Login with admin / Admin@123456
-- 2. CHANGE ADMIN PASSWORD IMMEDIATELY!
-- 3. Go to Settings > AI Models and configure API keys
-- 4. Enable the models you want to use
-- =====================================================
