-- 019_fix_table_names.sql
-- 修正表名和添加缺失的迁移记录

-- 1. 确保schema_migrations表存在
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` varchar(255) NOT NULL,
  `executed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 记录之前的迁移（如果不存在）
INSERT IGNORE INTO schema_migrations (version) VALUES 
('001_create_tables'),
('002_add_token_blacklist'),
('003_add_image_upload_to_ai_models'),
('004_create_files_table'),
('005_add_credits_expire'),
('006_add_user_remark'),
('007_add_unique_index_to_ai_model_groups'),
('008_add_group_credits_pool'),
('009_create_system_settings_table'),
('010_modify_system_modules_for_external_apps'),
('011_add_user_and_group_expire'),
('012_add_model_name_to_messages'),
('013_add_performance_indexes'),
('014_create_api_services_tables'),
('015_add_group_site_config'),
('016_add_system_prompts'),
('017_update_system_prompts_content_size'),
('018_create_knowledge_modules');

-- 3. 记录本次迁移
INSERT INTO schema_migrations (version, executed_at) 
VALUES ('019_fix_table_names', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
