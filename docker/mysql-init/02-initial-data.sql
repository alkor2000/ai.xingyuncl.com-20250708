-- =====================================================
-- AI Practice Platform - Initial Data
-- Run after 01-complete-database-structure.sql
-- Default admin: admin / Admin@123456
-- =====================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Default User Group
INSERT INTO `user_groups` (`id`, `name`, `description`, `color`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
(1, 'Default', 'Default user group', '#1890ff', 1, 0, NOW(), NOW());

-- 2. Admin User (password: Admin@123456)
INSERT INTO `users` (`id`, `uuid`, `username`, `email`, `password_hash`, `role`, `group_id`, `status`, `credits_quota`, `used_credits`, `created_at`, `updated_at`) VALUES
(1, UUID(), 'admin', 'admin@example.com', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe0JhbNFrdOTkG8d0LULZ0Z4Qq.i', 'super_admin', 1, 'active', 999999, 0, NOW(), NOW());

-- 3. Essential System Settings
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `created_at`, `updated_at`) VALUES
('site_name', 'AI Practice Platform', NOW(), NOW()),
('site_description', 'AI Application and Practice Platform', NOW(), NOW()),
('allow_registration', 'true', NOW(), NOW()),
('default_credits', '1000', NOW(), NOW()),
('system_prompts_enabled', 'true', NOW(), NOW()),
('invitation_code_required', 'false', NOW(), NOW());

-- 4. Sample AI Model (configure API key in admin panel)
INSERT INTO `ai_models` (`id`, `name`, `provider`, `model_name`, `api_endpoint`, `api_key`, `is_active`, `is_public`, `credits_per_chat`, `supports_streaming`, `supports_images`, `max_tokens`, `description`, `created_at`, `updated_at`) VALUES
(1, 'DeepSeek V3', 'openai', 'deepseek-chat', 'https://api.deepseek.com/v1/chat/completions', '', 0, 1, 2, 1, 0, 4096, 'DeepSeek V3 - Configure API key to enable', NOW(), NOW());

-- 5. Agent Node Types
INSERT INTO `agent_node_types` (`id`, `type_key`, `name`, `description`, `category`, `config_schema`, `is_active`, `credits_per_execution`, `max_inputs`, `max_outputs`, `display_order`, `created_at`, `updated_at`) VALUES
(1, 'start', 'Start', 'Workflow start node', 'basic', '{}', 1, 0, 0, 1, 1, NOW(), NOW()),
(2, 'end', 'End', 'Workflow end node', 'basic', '{}', 1, 0, 1, 0, 100, NOW(), NOW()),
(3, 'llm', 'LLM', 'Large Language Model node', 'ai', '{}', 1, 0, 1, 1, 10, NOW(), NOW()),
(4, 'knowledge', 'Knowledge', 'Knowledge retrieval node', 'data', '{}', 1, 0, 1, 1, 20, NOW(), NOW()),
(5, 'classifier', 'Classifier', 'Question classifier node', 'ai', '{}', 1, 0, 1, 10, 15, NOW(), NOW());

-- 6. Calendar Config
INSERT INTO `calendar_config` (`id`, `credit_multiplier`, `created_at`, `updated_at`) VALUES
(1, 1.0, NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- After import:
-- 1. Login with admin / Admin@123456
-- 2. Change admin password immediately
-- 3. Configure AI model API keys in Settings > AI Models
-- 4. Configure other settings as needed
-- =====================================================
