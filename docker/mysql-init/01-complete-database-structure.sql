
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `ai_model_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_model_groups` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `model_id` bigint NOT NULL COMMENT 'AI模型ID',
  `group_id` bigint NOT NULL COMMENT '用户组ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `created_by` bigint DEFAULT NULL COMMENT '创建者用户ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_model_group` (`model_id`,`group_id`),
  KEY `idx_model_id` (`model_id`),
  KEY `idx_group_id` (`group_id`),
  CONSTRAINT `fk_model_group_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_model_group_model` FOREIGN KEY (`model_id`) REFERENCES `ai_models` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_model_groups_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_model_groups_model` FOREIGN KEY (`model_id`) REFERENCES `ai_models` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=145 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型与用户组关联表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_models`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_models` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型标识符',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `api_key` text COLLATE utf8mb4_unicode_ci COMMENT 'API密钥',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提供商',
  `api_endpoint` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API端点',
  `model_config` json DEFAULT NULL COMMENT '模型配置参数',
  `stream_enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用流式输出',
  `image_upload_enabled` tinyint(1) DEFAULT '0' COMMENT '是否支持图片上传',
  `file_upload_enabled` tinyint(1) DEFAULT '0' COMMENT '是否支持文件上传',
  `credits_per_chat` int DEFAULT '10' COMMENT '每次对话消耗积分',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `is_public` tinyint(1) DEFAULT '1' COMMENT '是否对所有组开放',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `test_status` enum('untested','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'untested' COMMENT '测试状态',
  `last_tested_at` timestamp NULL DEFAULT NULL COMMENT '最后测试时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_name` (`name`),
  KEY `idx_provider` (`provider`),
  KEY `idx_active` (`is_active`),
  KEY `idx_sort` (`sort_order`),
  KEY `idx_credits_per_chat` (`credits_per_chat`),
  KEY `idx_stream` (`stream_enabled`),
  KEY `idx_image_upload` (`image_upload_enabled`),
  KEY `idx_is_public` (`is_public`),
  KEY `idx_file_upload` (`file_upload_enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `api_service_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_service_actions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `service_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联的服务ID',
  `action_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型',
  `action_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作显示名称',
  `credits` int NOT NULL DEFAULT '1' COMMENT '消耗积分数',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '操作说明',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '状态',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_service_action` (`service_id`,`action_type`),
  KEY `idx_service_id` (`service_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `api_service_actions_ibfk_1` FOREIGN KEY (`service_id`) REFERENCES `api_services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API服务操作配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `api_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_services` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `service_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '服务唯一标识',
  `service_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '服务显示名称',
  `api_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'API密钥',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '服务描述',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '状态',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `service_id` (`service_id`),
  KEY `idx_service_id` (`service_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API服务配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `billing_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对话ID',
  `message_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '消息ID',
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '使用的模型',
  `billing_type` enum('tokens','credits') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '计费类型',
  `amount` int NOT NULL COMMENT '消费数量',
  `tokens_used` int DEFAULT '0' COMMENT '实际Token使用量',
  `credits_used` int DEFAULT '0' COMMENT '实际积分使用量',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_conversation_id` (`conversation_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_billing_type` (`billing_type`),
  KEY `idx_billing_logs_user_created` (`user_id`,`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='计费记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `combination_modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `combination_modules` (
  `combination_id` bigint NOT NULL COMMENT '组合ID',
  `module_id` bigint NOT NULL COMMENT '模块ID',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序顺序',
  `added_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`combination_id`,`module_id`),
  KEY `idx_module_id` (`module_id`),
  CONSTRAINT `combination_modules_combination_fk` FOREIGN KEY (`combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `combination_modules_module_fk` FOREIGN KEY (`module_id`) REFERENCES `knowledge_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组合-模块关联表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话UUID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT 'New Chat' COMMENT '会话标题',
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '使用的AI模型',
  `system_prompt` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '系统提示词',
  `system_prompt_id` int DEFAULT NULL COMMENT '使用的系统提示词ID',
  `module_combination_id` bigint DEFAULT NULL COMMENT '使用的模块组合ID',
  `is_pinned` tinyint(1) DEFAULT '0' COMMENT '是否置顶',
  `priority` int DEFAULT '0' COMMENT '优先级(0-10)，数字越大排序越靠前',
  `message_count` int DEFAULT '0' COMMENT '消息数量',
  `total_tokens` int DEFAULT '0' COMMENT '总Token消耗',
  `last_message_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后消息时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `context_length` int unsigned DEFAULT '20' COMMENT '对话上下文条目数量 (0-1000)',
  `ai_temperature` decimal(3,2) DEFAULT '0.00' COMMENT 'AI创造性参数(0.0-1.0)',
  `cleared_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_model_name` (`model_name`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_last_message` (`last_message_at`),
  KEY `idx_user_updated` (`user_id`,`updated_at`),
  KEY `idx_priority_updated` (`user_id`,`priority` DESC,`updated_at` DESC),
  KEY `idx_conversations_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_conversations_user_priority` (`user_id`,`priority` DESC,`created_at` DESC),
  KEY `idx_conversations_cleared_at` (`cleared_at`),
  KEY `idx_system_prompt_id` (`system_prompt_id`),
  KEY `idx_module_combination_id` (`module_combination_id`),
  CONSTRAINT `conversations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversations_module_combination_fk` FOREIGN KEY (`module_combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_context_length` CHECK ((`context_length` between 0 and 1000)),
  CONSTRAINT `chk_temperature` CHECK ((`ai_temperature` between 0.0 and 1.0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `credit_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `credit_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `amount` int NOT NULL COMMENT '积分变动数量，正数为充值，负数为消耗',
  `balance_after` int NOT NULL COMMENT '操作后积分余额',
  `transaction_type` enum('admin_add','admin_deduct','admin_set','chat_consume','system_reward','group_distribute','group_recycle','api_consume') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `related_model_id` bigint DEFAULT NULL COMMENT '相关AI模型ID（对话消耗时使用）',
  `related_conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '相关对话ID（对话消耗时使用）',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '操作描述',
  `operator_id` bigint DEFAULT NULL COMMENT '操作员ID（管理员操作时使用）',
  `distributor_id` bigint DEFAULT NULL COMMENT '分配者ID（组内分配时记录）',
  `service_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API服务ID',
  `action_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API操作类型',
  `request_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求唯一ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `related_model_id` (`related_model_id`),
  KEY `related_conversation_id` (`related_conversation_id`),
  KEY `operator_id` (`operator_id`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_distributor` (`distributor_id`),
  KEY `idx_credit_transactions_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_service_id` (`service_id`),
  KEY `idx_request_id` (`request_id`),
  CONSTRAINT `credit_transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credit_transactions_ibfk_2` FOREIGN KEY (`related_model_id`) REFERENCES `ai_models` (`id`) ON DELETE SET NULL,
  CONSTRAINT `credit_transactions_ibfk_3` FOREIGN KEY (`related_conversation_id`) REFERENCES `conversations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `credit_transactions_ibfk_4` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1634 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户积分变动历史记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `files` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件UUID',
  `user_id` bigint NOT NULL COMMENT '上传用户ID',
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联会话ID',
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原始文件名',
  `stored_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '存储文件名',
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件路径',
  `file_size` bigint NOT NULL COMMENT '文件大小（字节）',
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'MIME类型',
  `extracted_content` text COLLATE utf8mb4_unicode_ci COMMENT 'AI提取的文本内容',
  `status` enum('uploading','processing','ready','error') COLLATE utf8mb4_unicode_ci DEFAULT 'uploading' COMMENT '文件状态',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_conversation_id` (`conversation_id`),
  KEY `idx_status` (`status`),
  KEY `idx_files_user_created` (`user_id`,`created_at` DESC),
  CONSTRAINT `files_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `files_ibfk_2` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `knowledge_modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knowledge_modules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模块描述',
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块内容',
  `prompt_type` enum('system','normal') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal' COMMENT '提示词类型：system-系统级，normal-普通',
  `module_scope` enum('personal','team','system') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'personal' COMMENT '模块范围：personal-个人，team-团队，system-系统',
  `content_visible` tinyint(1) DEFAULT '1' COMMENT '内容是否可见（仅对团队和系统模块有效）',
  `creator_id` bigint NOT NULL COMMENT '创建者ID',
  `group_id` bigint DEFAULT NULL COMMENT '团队模块所属的组ID',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '分类',
  `tags` json DEFAULT NULL COMMENT '标签',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `usage_count` int DEFAULT '0' COMMENT '使用次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_module_scope` (`module_scope`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `knowledge_modules_creator_fk` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_modules_group_fk` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识模块表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messages` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息UUID',
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID',
  `role` enum('user','assistant','system') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息角色',
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息内容',
  `tokens` int DEFAULT '0' COMMENT '该消息Token数',
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI模型名称',
  `file_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联文件ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_conversation_id` (`conversation_id`),
  KEY `idx_conversation_created` (`conversation_id`,`created_at`),
  KEY `idx_role` (`role`),
  KEY `idx_file_id` (`file_id`),
  KEY `idx_model_name` (`model_name`),
  KEY `idx_messages_conversation_created` (`conversation_id`,`created_at` DESC),
  KEY `idx_messages_role` (`role`),
  KEY `idx_messages_model_name` (`model_name`),
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `module_combination_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `module_combination_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `combination_id` bigint NOT NULL,
  `module_id` bigint NOT NULL,
  `order_index` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_combination_module` (`combination_id`,`module_id`),
  KEY `idx_combination_id` (`combination_id`),
  KEY `idx_module_id` (`module_id`),
  CONSTRAINT `fk_combination_items_combination` FOREIGN KEY (`combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_combination_items_module` FOREIGN KEY (`module_id`) REFERENCES `knowledge_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `module_combinations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `module_combinations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '组合名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '组合描述',
  `user_id` bigint NOT NULL COMMENT '创建者ID',
  `estimated_tokens` int DEFAULT '0' COMMENT '预估的token数',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `usage_count` int DEFAULT '0' COMMENT '使用次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `module_combinations_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块组合表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `permission_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '权限类型',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_permission` (`user_id`,`permission_type`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_permission_type` (`permission_type`),
  CONSTRAINT `permissions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户权限表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `system_modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_modules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名称',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模块描述',
  `module_type` enum('frontend','backend','fullstack') COLLATE utf8mb4_unicode_ci DEFAULT 'fullstack' COMMENT '模块类型',
  `api_endpoint` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API端点地址',
  `frontend_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前端访问地址',
  `module_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模块访问URL',
  `open_mode` enum('iframe','new_tab') COLLATE utf8mb4_unicode_ci DEFAULT 'new_tab' COMMENT '打开方式：iframe嵌入或新标签页',
  `menu_icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'AppstoreOutlined' COMMENT '菜单图标（Ant Design图标名称）',
  `proxy_path` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '代理路径',
  `auth_mode` enum('jwt','oauth','none') COLLATE utf8mb4_unicode_ci DEFAULT 'jwt' COMMENT '认证模式',
  `is_active` tinyint(1) DEFAULT '0' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `permissions` json DEFAULT NULL COMMENT '所需权限',
  `allowed_groups` json DEFAULT NULL COMMENT '允许访问的用户组ID列表',
  `config` json DEFAULT NULL COMMENT '模块配置',
  `health_check_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '健康检查地址',
  `status` enum('unknown','online','offline','error') COLLATE utf8mb4_unicode_ci DEFAULT 'unknown' COMMENT '运行状态',
  `last_check_at` timestamp NULL DEFAULT NULL COMMENT '最后检查时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`),
  UNIQUE KEY `uk_proxy_path` (`proxy_path`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_active_sort` (`is_active`,`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统模块配置表 - 支持外部应用集成';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `system_prompt_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_prompt_groups` (
  `prompt_id` int NOT NULL COMMENT '提示词ID',
  `group_id` bigint NOT NULL COMMENT '用户组ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`prompt_id`,`group_id`),
  KEY `idx_group_id` (`group_id`),
  CONSTRAINT `system_prompt_groups_ibfk_1` FOREIGN KEY (`prompt_id`) REFERENCES `system_prompts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `system_prompt_groups_ibfk_2` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词与用户组关联表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `system_prompts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_prompts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词名称',
  `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '提示词描述',
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词内容（支持最大16MB）',
  `group_ids` json DEFAULT NULL COMMENT '可见的用户组ID列表，NULL表示所有用户可见',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序，越小越靠前',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_by` int DEFAULT NULL COMMENT '创建人ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active_sort` (`is_active`,`sort_order`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统提示词表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置键',
  `setting_value` text COLLATE utf8mb4_unicode_ci COMMENT '配置值（JSON格式）',
  `setting_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'string' COMMENT '配置类型',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '配置说明',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_key` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=1010 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `token_blacklist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `token_blacklist` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `token_jti` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'JWT ID',
  `token_type` enum('access','refresh') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'access',
  `expires_at` datetime NOT NULL COMMENT 'Token过期时间',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token_jti` (`token_jti`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `fk_blacklist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token黑名单';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_activities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_activities` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_user_activities_created` (`created_at`),
  KEY `idx_user_activities_user_created` (`user_id`,`created_at`),
  CONSTRAINT `user_activities_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1239 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_groups` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分组名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '分组描述',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1677ff' COMMENT '分组颜色标识',
  `billing_config` json DEFAULT NULL COMMENT '计费配置',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `credits_pool` int DEFAULT '0' COMMENT '组积分池总额',
  `credits_pool_used` int DEFAULT '0' COMMENT '组积分池已使用额度',
  `user_limit` int DEFAULT '10' COMMENT '组员上限',
  `expire_date` date DEFAULT NULL COMMENT '组有效期（所有组员统一到期日期）',
  `created_by` bigint DEFAULT NULL COMMENT '创建者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `site_customization_enabled` tinyint(1) DEFAULT '0' COMMENT '是否允许自定义站点配置',
  `site_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '组站点名称',
  `site_logo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '组站点logo URL',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_name` (`name`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_credits_pool` (`credits_pool`,`credits_pool_used`),
  KEY `idx_site_customization` (`site_customization_enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户分组表（支持独立站点配置）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_model_restrictions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_model_restrictions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `model_id` bigint NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_model` (`user_id`,`model_id`),
  KEY `created_by` (`created_by`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_model_id` (`model_id`),
  CONSTRAINT `user_model_restrictions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_model_restrictions_ibfk_2` FOREIGN KEY (`model_id`) REFERENCES `ai_models` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_model_restrictions_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户AI模型使用限制表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户邮箱',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `username` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户名',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '加密密码',
  `role` enum('super_admin','admin','user') COLLATE utf8mb4_unicode_ci DEFAULT 'user' COMMENT '用户角色',
  `group_id` bigint DEFAULT NULL COMMENT '用户分组ID',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '用户状态',
  `remark` text COLLATE utf8mb4_unicode_ci COMMENT '管理员备注',
  `email_verified` tinyint(1) DEFAULT '0' COMMENT '邮箱是否已验证',
  `email_verification_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮箱验证令牌',
  `password_reset_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '密码重置令牌',
  `password_reset_expires` timestamp NULL DEFAULT NULL COMMENT '密码重置过期时间',
  `avatar_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像地址',
  `token_quota` int DEFAULT '10000' COMMENT 'Token配额',
  `credits_quota` int DEFAULT '1000' COMMENT '积分配额',
  `login_attempts` int DEFAULT '0' COMMENT '登录尝试次数',
  `used_tokens` int DEFAULT '0' COMMENT '已使用Token',
  `used_credits` int DEFAULT '0' COMMENT '已使用积分',
  `credits_expire_at` timestamp NULL DEFAULT NULL COMMENT '积分过期时间',
  `expire_at` timestamp NULL DEFAULT NULL COMMENT '账号有效期',
  `last_login_at` timestamp NULL DEFAULT NULL COMMENT '最后登录时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_email` (`email`),
  KEY `idx_username` (`username`),
  KEY `idx_role` (`role`),
  KEY `idx_status` (`status`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_credits_quota` (`credits_quota`),
  KEY `idx_used_credits` (`used_credits`),
  KEY `idx_credits_expire` (`credits_expire_at`),
  KEY `idx_expire_at` (`expire_at`),
  FULLTEXT KEY `idx_remark` (`remark`)
) ENGINE=InnoDB AUTO_INCREMENT=111 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表 - 包含账号有效期和积分有效期';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 DROP PROCEDURE IF EXISTS `cleanup_expired_tokens` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`ai_user`@`localhost` PROCEDURE `cleanup_expired_tokens`()
BEGIN
  DELETE FROM token_blacklist WHERE expires_at < NOW();
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `DeductUserCredits` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`ai_user`@`localhost` PROCEDURE `DeductUserCredits`(
  IN p_user_id BIGINT,
  IN p_amount INT,
  IN p_model_id BIGINT,
  IN p_conversation_id VARCHAR(36),
  OUT p_success BOOLEAN,
  OUT p_new_balance INT
)
BEGIN
  DECLARE current_balance INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION 
  BEGIN
    ROLLBACK;
    SET p_success = FALSE;
    SET p_new_balance = -1;
  END;
  
  START TRANSACTION;
  
  
  SELECT (credits_quota - used_credits) INTO current_balance 
  FROM users WHERE id = p_user_id FOR UPDATE;
  
  
  IF current_balance >= p_amount THEN
    
    UPDATE users SET used_credits = used_credits + p_amount WHERE id = p_user_id;
    
    
    INSERT INTO credit_transactions (
      user_id, amount, balance_after, transaction_type, 
      related_model_id, related_conversation_id, description
    ) VALUES (
      p_user_id, -p_amount, current_balance - p_amount, 'chat_consume',
      p_model_id, p_conversation_id, CONCAT('AI对话消耗积分，模型ID:', p_model_id)
    );
    
    SET p_success = TRUE;
    SET p_new_balance = current_balance - p_amount;
    COMMIT;
  ELSE
    SET p_success = FALSE;
    SET p_new_balance = current_balance;
    ROLLBACK;
  END IF;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

