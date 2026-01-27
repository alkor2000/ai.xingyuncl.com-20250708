
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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_executions` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '执行记录ID',
  `workflow_id` bigint NOT NULL COMMENT '工作流ID',
  `user_id` bigint NOT NULL COMMENT '执行用户ID',
  `input_data` json DEFAULT NULL COMMENT '输入参数',
  `output_data` json DEFAULT NULL COMMENT '输出结果',
  `execution_log` json DEFAULT NULL COMMENT '执行日志（包含每个节点的详细信息）',
  `status` enum('running','success','failed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'running' COMMENT '执行状态',
  `total_credits_used` int DEFAULT '0' COMMENT '消耗的总积分',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息（失败时记录）',
  `started_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `duration_ms` int DEFAULT NULL COMMENT '执行时长（毫秒）',
  PRIMARY KEY (`id`),
  KEY `idx_workflow_id` (`workflow_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_started_at` (`started_at`),
  CONSTRAINT `agent_executions_ibfk_1` FOREIGN KEY (`workflow_id`) REFERENCES `agent_workflows` (`id`) ON DELETE CASCADE,
  CONSTRAINT `agent_executions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=88 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent执行记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_node_executions` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '节点执行日志ID',
  `execution_id` bigint NOT NULL COMMENT '所属执行记录ID',
  `node_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '节点ID（前端生成的唯一标识）',
  `node_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '节点类型（如：llm, knowledge）',
  `node_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '节点名称（用户自定义）',
  `input_data` json DEFAULT NULL COMMENT '节点输入数据',
  `output_data` json DEFAULT NULL COMMENT '节点输出数据',
  `credits_used` int DEFAULT '0' COMMENT '节点消耗的积分',
  `status` enum('pending','running','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '节点执行状态',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '节点错误信息',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `duration_ms` int DEFAULT NULL COMMENT '执行时长（毫秒）',
  PRIMARY KEY (`id`),
  KEY `idx_execution_id` (`execution_id`),
  KEY `idx_node_type` (`node_type`),
  KEY `idx_status` (`status`),
  CONSTRAINT `agent_node_executions_ibfk_1` FOREIGN KEY (`execution_id`) REFERENCES `agent_executions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=223 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='节点执行日志表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_node_types` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '节点类型ID',
  `type_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '节点类型唯一标识（如：start, llm, knowledge）',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '节点显示名称',
  `category` enum('input','process','output','control') COLLATE utf8mb4_unicode_ci DEFAULT 'process' COMMENT '节点分类：输入/处理/输出/控制',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'NodeIndexOutlined' COMMENT 'Ant Design图标名称',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1890ff' COMMENT '节点主题颜色（HEX）',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '节点功能描述',
  `config_schema` json DEFAULT NULL COMMENT '节点配置字段的JSON Schema定义',
  `credits_per_execution` int DEFAULT '0' COMMENT '每次执行消耗的积分',
  `max_inputs` int DEFAULT '1' COMMENT '最大输入连接数（0表示不能有输入）',
  `max_outputs` int DEFAULT '1' COMMENT '最大输出连接数（0表示不能有输出）',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `display_order` int DEFAULT '0' COMMENT '显示顺序（数字越小越靠前）',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `type_key` (`type_key`),
  KEY `idx_category` (`category`),
  KEY `idx_active` (`is_active`),
  KEY `idx_display_order` (`display_order`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent节点类型配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_workflow_templates` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '模板ID',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模板描述',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模板分类（如：数据分析、内容生成）',
  `template_data` json NOT NULL COMMENT '模板的flow_data（节点和连线）',
  `preview_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '预览图URL',
  `is_system` tinyint(1) DEFAULT '0' COMMENT '是否系统内置模板',
  `created_by` bigint DEFAULT NULL COMMENT '创建者用户ID',
  `usage_count` int DEFAULT '0' COMMENT '被使用次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_system` (`is_system`),
  KEY `idx_usage_count` (`usage_count`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `agent_workflow_templates_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流模板表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_workflows` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '工作流ID',
  `user_id` bigint NOT NULL COMMENT '创建用户ID',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工作流名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '工作流描述',
  `flow_data` json NOT NULL COMMENT '节点和连线的JSON数据（包含nodes和edges）',
  `is_published` tinyint(1) DEFAULT '0' COMMENT '是否发布（发布后用户可执行）',
  `version` int DEFAULT '1' COMMENT '版本号',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_published` (`is_published`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `agent_workflows_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI工作流主表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
) ENGINE=InnoDB AUTO_INCREMENT=530 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型与用户组关联表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
  `image_generation_enabled` tinyint(1) DEFAULT '0' COMMENT '是否支持图片生成(AI生成图片)',
  `document_upload_enabled` tinyint(1) DEFAULT '0' COMMENT '是否支持文档上传',
  `audio_upload_enabled` tinyint(1) DEFAULT '0' COMMENT '是否支持音频上传',
  `video_upload_enabled` tinyint(1) DEFAULT '0' COMMENT '是否支持视频上传',
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
  KEY `idx_file_upload` (`file_upload_enabled`),
  KEY `idx_document_upload` (`document_upload_enabled`),
  KEY `idx_image_generation` (`image_generation_enabled`),
  KEY `idx_audio_enabled` (`audio_upload_enabled`),
  KEY `idx_video_enabled` (`video_upload_enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `application_form_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `button_text` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '申请企业账号' COMMENT '申请按钮文字',
  `button_visible` tinyint(1) DEFAULT '1' COMMENT '按钮是否显示',
  `application_rules` text COLLATE utf8mb4_unicode_ci COMMENT '申请规则说明',
  `org_name_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '企业/组织/学校名称' COMMENT '组织名称字段标签',
  `applicant_email_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '申请人邮箱' COMMENT '申请人邮箱字段标签',
  `business_license_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '营业执照' COMMENT '营业执照字段标签',
  `invitation_code_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '邀请码' COMMENT '邀请码字段标签',
  `contact_name_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '联系人姓名' COMMENT '联系人姓名字段标签',
  `contact_name_required` tinyint(1) DEFAULT '0',
  `contact_name_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'text',
  `contact_name_options` json DEFAULT NULL,
  `contact_phone_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '联系电话' COMMENT '联系电话字段标签',
  `contact_phone_required` tinyint(1) DEFAULT '0',
  `contact_phone_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'text',
  `contact_phone_options` json DEFAULT NULL,
  `application_reason_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '申请说明' COMMENT '申请说明字段标签',
  `application_reason_required` tinyint(1) DEFAULT '0',
  `application_reason_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'text',
  `application_reason_options` json DEFAULT NULL,
  `invitation_code_required` tinyint(1) DEFAULT '0' COMMENT '邀请码是否必填',
  `default_group_id` bigint DEFAULT '1' COMMENT '默认分配的用户组',
  `default_credits` int DEFAULT '0' COMMENT '默认积分',
  `auto_approve` tinyint(1) DEFAULT '0' COMMENT '是否自动审批',
  `email_notification` tinyint(1) DEFAULT '1' COMMENT '是否发送邮件通知',
  `updated_by` bigint DEFAULT NULL COMMENT '最后更新人',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_updated_by` (`updated_by`),
  CONSTRAINT `fk_form_config_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='申请表单配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_ai_analyses` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '分析ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `scan_date_start` date NOT NULL COMMENT '扫描开始日期',
  `scan_date_end` date NOT NULL COMMENT '扫描结束日期',
  `model_id` bigint DEFAULT NULL COMMENT 'AI模型ID',
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型名称快照',
  `analysis_result` json DEFAULT NULL COMMENT '分析结果（JSON格式）',
  `credits_consumed` int DEFAULT '0' COMMENT '消耗积分',
  `events_count` int DEFAULT '0' COMMENT '分析的事项数量',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_date` (`user_id`,`created_at`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_model_date` (`model_id`,`created_at` DESC),
  CONSTRAINT `calendar_ai_analyses_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `calendar_ai_analyses_ibfk_2` FOREIGN KEY (`model_id`) REFERENCES `ai_models` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=67 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI分析历史表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_background_knowledge` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_uuid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户UUID（支持SSO）',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题（最多100字符）',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '内容（最多2000字符）',
  `enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用（支持多选）',
  `sort_order` int DEFAULT '0' COMMENT '排序（数字越小越靠前）',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_uuid` (`user_uuid`) COMMENT '用户UUID索引',
  KEY `idx_enabled` (`enabled`) COMMENT '启用状态索引',
  KEY `idx_sort_order` (`sort_order`) COMMENT '排序索引',
  KEY `idx_user_enabled_order` (`user_uuid`,`enabled`,`sort_order`) COMMENT '复合查询索引'
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历背景知识表 - 用户个人信息、职业背景、生活习惯等';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_categories` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '分类ID',
  `user_id` bigint DEFAULT NULL COMMENT '用户ID（NULL表示系统预设）',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类名称',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1890ff' COMMENT '颜色',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'TagOutlined' COMMENT '图标',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_name` (`user_id`,`name`),
  KEY `idx_user` (`user_id`),
  KEY `idx_user_active_sort` (`user_id`,`is_active`,`sort_order`),
  CONSTRAINT `calendar_categories_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历分类表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `credits_multiplier` decimal(3,1) DEFAULT '1.0' COMMENT '积分倍数（1.0-10.0）',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_multiplier_range` CHECK (((`credits_multiplier` >= 1.0) and (`credits_multiplier` <= 10.0)))
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_events` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '事项ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事项标题（必填）',
  `event_date` date NOT NULL COMMENT '事项日期',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '事项内容（可选，支持Markdown）',
  `importance` tinyint DEFAULT '5' COMMENT '重要度（0-10）',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '其他' COMMENT '分类',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1890ff' COMMENT '颜色值',
  `status` enum('daily','not_started','in_progress','completed') COLLATE utf8mb4_unicode_ci DEFAULT 'not_started' COMMENT '状态',
  `file_link` text COLLATE utf8mb4_unicode_ci COMMENT '云盘文件链接',
  `recurrence_type` enum('none','daily','weekly','monthly','yearly') COLLATE utf8mb4_unicode_ci DEFAULT 'none' COMMENT '重复类型',
  `recurrence_end_date` date DEFAULT NULL COMMENT '重复结束日期',
  `parent_event_id` bigint DEFAULT NULL COMMENT '父事项ID（重复事项）',
  `sort_order` int DEFAULT '0' COMMENT '同一天内排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_date` (`user_id`,`event_date`),
  KEY `idx_status` (`status`),
  KEY `idx_category` (`category`),
  KEY `idx_parent` (`parent_event_id`),
  KEY `idx_user_date_status` (`user_id`,`event_date`,`status`),
  KEY `idx_user_importance` (`user_id`,`importance` DESC),
  KEY `idx_date_importance` (`event_date`,`importance` DESC),
  KEY `idx_user_year_month` (`user_id`,`event_date`,`status`,`importance`),
  KEY `idx_user_category_date` (`user_id`,`category`,`event_date`),
  KEY `idx_title` (`title`),
  CONSTRAINT `calendar_events_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `calendar_events_ibfk_2` FOREIGN KEY (`parent_event_id`) REFERENCES `calendar_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历事项表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_prompt_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `prompt` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词内容（支持变量替换）',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模板描述',
  `is_default` tinyint(1) DEFAULT '0' COMMENT '是否默认模板',
  `display_order` int DEFAULT '0' COMMENT '显示顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active_order` (`is_active`,`display_order`),
  KEY `idx_default` (`is_default`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历提示词模板表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_prompt_templates_backup_20251011` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `prompt` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词内容（支持变量替换）',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模板描述',
  `is_default` tinyint(1) DEFAULT '0' COMMENT '是否默认模板',
  `display_order` int DEFAULT '0' COMMENT '显示顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active_order` (`is_active`,`display_order`),
  KEY `idx_default` (`is_default`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历提示词模板表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_user_settings` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '设置ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `auto_analysis_enabled` tinyint(1) DEFAULT '0' COMMENT '自动分析开关',
  `auto_analysis_frequency` enum('daily','weekly','monthly') COLLATE utf8mb4_unicode_ci DEFAULT 'weekly' COMMENT '自动分析频率',
  `default_scan_range` int DEFAULT '15' COMMENT '默认扫描天数',
  `default_model_id` bigint DEFAULT NULL COMMENT '默认AI模型ID',
  `template_id` bigint DEFAULT NULL COMMENT 'AI分析模板ID',
  `scan_days_before` int DEFAULT '15' COMMENT '今日前扫描天数',
  `scan_days_after` int DEFAULT '15' COMMENT '今日后扫描天数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `default_model_id` (`default_model_id`),
  CONSTRAINT `calendar_user_settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `calendar_user_settings_ibfk_2` FOREIGN KEY (`default_model_id`) REFERENCES `ai_models` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历用户设置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `casbin_deny_policies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `subject` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `object` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_deny` (`subject`,`object`,`action`),
  KEY `idx_subject` (`subject`),
  KEY `idx_object` (`object`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Casbin拒绝策略表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `casbin_metadata` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sync_version` bigint DEFAULT '0' COMMENT '同步版本号',
  `last_sync_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后同步时间',
  `sync_status` enum('pending','syncing','completed','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '同步状态',
  `notes` text COLLATE utf8mb4_unicode_ci COMMENT '备注',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Casbin同步元数据';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `casbin_rule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ptype` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `v0` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `v1` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `v2` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `v3` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `v4` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `v5` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_rule` (`ptype`,`v0`,`v1`,`v2`,`v3`,`v4`,`v5`),
  KEY `idx_ptype` (`ptype`),
  KEY `idx_v0` (`v0`),
  KEY `idx_v1` (`v1`)
) ENGINE=InnoDB AUTO_INCREMENT=2312 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Casbin权限规则表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
  `smart_app_id` bigint DEFAULT NULL COMMENT '关联的智能应用ID',
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
  KEY `idx_smart_app_id` (`smart_app_id`),
  CONSTRAINT `conversations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `conversations_module_combination_fk` FOREIGN KEY (`module_combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_context_length` CHECK ((`context_length` between 0 and 1000)),
  CONSTRAINT `chk_temperature` CHECK ((`ai_temperature` between 0.0 and 1.0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `credit_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `amount` int NOT NULL COMMENT '积分变动数量，正数为充值，负数为消耗',
  `balance_after` int NOT NULL COMMENT '操作后积分余额',
  `transaction_type` enum('admin_add','admin_deduct','admin_set','chat_consume','image_consume','video_consume','system_reward','group_distribute','group_recycle','api_consume','html_create','html_update','html_publish','storage_upload','mindmap_save','mindmap_export','ocr_consume','calendar_analysis','agent_execution') COLLATE utf8mb4_unicode_ci DEFAULT 'chat_consume',
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
  KEY `idx_transaction_type_created` (`transaction_type`,`created_at`),
  CONSTRAINT `credit_transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credit_transactions_ibfk_2` FOREIGN KEY (`related_model_id`) REFERENCES `ai_models` (`id`) ON DELETE SET NULL,
  CONSTRAINT `credit_transactions_ibfk_3` FOREIGN KEY (`related_conversation_id`) REFERENCES `conversations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `credit_transactions_ibfk_4` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=8836 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户积分变动历史记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `file_shares` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '分享者',
  `file_id` bigint DEFAULT NULL COMMENT '文件ID',
  `folder_id` bigint DEFAULT NULL COMMENT '文件夹ID',
  `share_code` varchar(32) NOT NULL COMMENT '分享码',
  `share_password` varchar(20) DEFAULT NULL COMMENT '访问密码',
  `expire_at` timestamp NULL DEFAULT NULL COMMENT '过期时间',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `max_views` int DEFAULT NULL COMMENT '最大查看次数',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否有效',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `share_code` (`share_code`),
  UNIQUE KEY `uk_share_code` (`share_code`),
  KEY `idx_user_id` (`user_id`),
  KEY `fk_file_shares_file` (`file_id`),
  KEY `fk_file_shares_folder` (`folder_id`),
  CONSTRAINT `fk_file_shares_file` FOREIGN KEY (`file_id`) REFERENCES `user_files` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_file_shares_folder` FOREIGN KEY (`folder_id`) REFERENCES `user_folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_file_shares_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='文件分享表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gemini_files` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint NOT NULL,
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gemini_file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Gemini API返回的文件名',
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size` bigint NOT NULL,
  `local_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地/OSS路径',
  `status` enum('uploading','processing','active','expired','error') COLLATE utf8mb4_unicode_ci DEFAULT 'uploading',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL DEFAULT NULL COMMENT '48小时后过期',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_conversation_id` (`conversation_id`),
  KEY `idx_status` (`status`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `gemini_files_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `gemini_files_ibfk_2` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Gemini Files API文件引用表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `html_pages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `project_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `html_content` longtext COLLATE utf8mb4_unicode_ci,
  `css_content` longtext COLLATE utf8mb4_unicode_ci,
  `js_content` longtext COLLATE utf8mb4_unicode_ci,
  `compiled_content` longtext COLLATE utf8mb4_unicode_ci,
  `version` int DEFAULT '1',
  `is_published` tinyint(1) DEFAULT '0',
  `publish_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `view_count` int DEFAULT '0',
  `like_count` int DEFAULT '0',
  `credits_consumed` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `published_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_slug` (`user_id`,`slug`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_slug` (`slug`),
  KEY `idx_is_published` (`is_published`),
  KEY `idx_view_count` (`view_count`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_user_slug` (`user_id`,`slug`),
  CONSTRAINT `html_pages_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `html_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `html_pages_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `html_pages_slug_backup` (
  `id` bigint DEFAULT NULL,
  `original_slug` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_slug` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `backup_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `html_projects` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `parent_id` bigint DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `path` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` enum('folder','page') COLLATE utf8mb4_unicode_ci DEFAULT 'page',
  `description` text COLLATE utf8mb4_unicode_ci,
  `tags` json DEFAULT NULL,
  `is_public` tinyint(1) DEFAULT '0',
  `password` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_default` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_type` (`type`),
  KEY `idx_is_public` (`is_public`),
  CONSTRAINT `html_projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `html_projects_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `html_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=133 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `html_resources` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `project_id` bigint DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size` bigint NOT NULL,
  `storage_type` enum('local','oss') COLLATE utf8mb4_unicode_ci DEFAULT 'local',
  `storage_path` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `oss_bucket` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `oss_key` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cdn_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `thumbnail_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metadata` json DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `download_count` int DEFAULT '0',
  `bandwidth_used` bigint DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_file_type` (`file_type`),
  KEY `idx_storage_type` (`storage_type`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `html_resources_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `html_resources_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `html_projects` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `html_templates` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `thumbnail` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `html_template` longtext COLLATE utf8mb4_unicode_ci,
  `css_template` longtext COLLATE utf8mb4_unicode_ci,
  `js_template` longtext COLLATE utf8mb4_unicode_ci,
  `description` text COLLATE utf8mb4_unicode_ci,
  `tags` json DEFAULT NULL,
  `usage_count` int DEFAULT '0',
  `is_premium` tinyint(1) DEFAULT '0',
  `credits_required` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_is_premium` (`is_premium`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `image_generations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `parent_id` bigint DEFAULT NULL COMMENT '父生成记录ID（用于U/V操作）',
  `action_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'IMAGINE' COMMENT '操作类型（IMAGINE/UPSCALE/VARIATION/REROLL等）',
  `action_index` int DEFAULT NULL COMMENT '操作索引（1-4）',
  `buttons` json DEFAULT NULL COMMENT '可用操作按钮',
  `generation_mode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'fast' COMMENT '生成模式（fast/turbo/relax）',
  `progress` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '进度信息',
  `grid_layout` tinyint(1) DEFAULT '0' COMMENT '是否为4图网格',
  `mj_custom_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Midjourney customId',
  `model_id` bigint DEFAULT NULL COMMENT '模型ID（可为空，模型删除后保留记录）',
  `task_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Midjourney任务ID',
  `prompt` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词',
  `negative_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '负面提示词',
  `prompt_en` text COLLATE utf8mb4_unicode_ci COMMENT '英文提示词',
  `size` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '图片尺寸',
  `seed` int DEFAULT '-1' COMMENT '随机种子',
  `guidance_scale` float DEFAULT '2.5' COMMENT '引导系数',
  `watermark` tinyint(1) DEFAULT '1' COMMENT '是否添加水印',
  `image_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始图片URL（火山方舟返回）',
  `local_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地存储路径',
  `thumbnail_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缩略图路径',
  `file_size` int DEFAULT NULL COMMENT '文件大小（字节）',
  `status` enum('pending','generating','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `task_status` enum('NOT_START','SUBMITTED','IN_PROGRESS','SUCCESS','FAILURE') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '任务状态',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `fail_reason` text COLLATE utf8mb4_unicode_ci COMMENT '失败原因',
  `credits_consumed` decimal(10,2) DEFAULT '0.00' COMMENT '消耗积分',
  `generation_time` int DEFAULT NULL COMMENT '生成耗时（毫秒）',
  `is_favorite` tinyint(1) DEFAULT '0' COMMENT '是否收藏',
  `is_public` tinyint(1) DEFAULT '0' COMMENT '是否公开',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_model` (`model_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_favorite` (`is_favorite`),
  KEY `idx_public` (`is_public`,`created_at`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_task_status` (`task_status`),
  CONSTRAINT `fk_parent_generation` FOREIGN KEY (`parent_id`) REFERENCES `image_generations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `image_generations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `image_generations_model_fk` FOREIGN KEY (`model_id`) REFERENCES `image_models` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3149 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图片生成历史表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `image_models` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型标识',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模型描述',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'volcano' COMMENT '提供商：volcano/openai/stable-diffusion',
  `generation_type` enum('sync','async') COLLATE utf8mb4_unicode_ci DEFAULT 'sync' COMMENT '生成类型：sync同步/async异步',
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'API端点',
  `api_key` text COLLATE utf8mb4_unicode_ci COMMENT '加密的API密钥',
  `model_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型ID，如doubao-seedream-3-0-t2i-250415',
  `api_config` json DEFAULT NULL COMMENT 'API特定配置（如Midjourney的mode等）',
  `webhook_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Webhook回调地址',
  `polling_interval` int DEFAULT '2000' COMMENT '轮询间隔（毫秒）',
  `max_polling_time` int DEFAULT '300000' COMMENT '最大轮询时间（毫秒）',
  `price_per_image` decimal(10,2) DEFAULT '1.00' COMMENT '每张图片消耗积分',
  `sizes_supported` json DEFAULT NULL COMMENT '支持的尺寸列表',
  `max_prompt_length` int DEFAULT '1000' COMMENT '最大提示词长度',
  `default_size` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '1024x1024' COMMENT '默认尺寸',
  `default_guidance_scale` float DEFAULT '2.5' COMMENT '默认引导系数',
  `example_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '示例提示词',
  `example_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '示例图片URL',
  `icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PictureOutlined' COMMENT '图标',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_active` (`is_active`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图像生成模型配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invitation_code_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `group_id` bigint NOT NULL,
  `invitation_code` varchar(10) NOT NULL,
  `user_id` bigint NOT NULL,
  `used_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_used_at` (`used_at`),
  CONSTRAINT `invitation_code_logs_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `invitation_code_logs_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='邀请码使用记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invitation_codes` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(6) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '6位邀请码',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注说明',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `usage_limit` int DEFAULT '-1' COMMENT '使用次数限制，-1表示无限',
  `used_count` int DEFAULT '0' COMMENT '已使用次数',
  `expires_at` datetime DEFAULT NULL COMMENT '过期时间',
  `created_by` bigint DEFAULT NULL COMMENT '创建人ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_active` (`is_active`),
  KEY `idx_expires` (`expires_at`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_invitation_codes_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请码管理表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knex_migrations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `batch` int DEFAULT NULL,
  `migration_time` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knex_migrations_lock` (
  `index` int unsigned NOT NULL AUTO_INCREMENT,
  `is_locked` int DEFAULT NULL,
  PRIMARY KEY (`index`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knowledge_module_tag_permissions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `module_id` bigint NOT NULL COMMENT '知识模块ID',
  `tag_id` bigint NOT NULL COMMENT '用户标签ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` bigint DEFAULT NULL COMMENT '创建者ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_tag` (`module_id`,`tag_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_tag_id` (`tag_id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_module_tag_combined` (`module_id`,`tag_id`),
  KEY `idx_created_by_date` (`created_by`,`created_at`),
  CONSTRAINT `knowledge_module_tag_permissions_ibfk_1` FOREIGN KEY (`module_id`) REFERENCES `knowledge_modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_module_tag_permissions_ibfk_2` FOREIGN KEY (`tag_id`) REFERENCES `user_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_module_tag_permissions_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='知识模块标签权限关系表 - 用于团队模块的访问控制，如果模块没有任何标签限制则表示全组可访问';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knowledge_modules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模块描述',
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块内容',
  `token_count` int DEFAULT '0' COMMENT 'Token数量估算',
  `prompt_type` enum('system','normal') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal' COMMENT '提示词类型：system-系统级，normal-普通',
  `module_scope` enum('personal','team','system') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'personal' COMMENT '模块范围：personal-个人，team-团队，system-系统',
  `content_visible` tinyint(1) DEFAULT '1' COMMENT '内容是否可见（仅对团队和系统模块有效）',
  `creator_id` bigint NOT NULL COMMENT '创建者ID',
  `group_id` bigint DEFAULT NULL COMMENT '团队模块所属的组ID（仅团队模块使用）',
  `group_ids` json DEFAULT NULL COMMENT '可见的用户组ID列表（仅系统级模块使用，NULL表示所有组可见）',
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
  KEY `idx_scope_group_active` (`module_scope`,`group_id`,`is_active`),
  CONSTRAINT `knowledge_modules_creator_fk` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_modules_group_fk` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识模块表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messages` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息UUID',
  `conversation_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID',
  `sequence_number` int DEFAULT '0' COMMENT '消息序号，用于保证正确的显示顺序',
  `role` enum('user','assistant','system') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息角色',
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息内容',
  `tokens` int DEFAULT '0' COMMENT '该消息Token数',
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI模型名称',
  `status` enum('pending','streaming','completed','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'completed' COMMENT '消息状态：pending-待处理，streaming-流式传输中，completed-已完成，failed-失败',
  `file_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联文件ID',
  `generated_images` json DEFAULT NULL COMMENT 'AI生成的图片URL数组',
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
  KEY `idx_status` (`status`),
  KEY `idx_conversation_status` (`conversation_id`,`status`),
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `midjourney_tasks` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `generation_id` bigint DEFAULT NULL,
  `task_id` varchar(100) NOT NULL,
  `action` varchar(20) NOT NULL COMMENT '操作类型',
  `status` varchar(20) NOT NULL DEFAULT 'SUBMITTED',
  `submit_time` bigint NOT NULL COMMENT '提交时间戳',
  `start_time` bigint DEFAULT NULL COMMENT '开始时间戳',
  `finish_time` bigint DEFAULT NULL COMMENT '完成时间戳',
  `properties` json DEFAULT NULL COMMENT '扩展属性',
  `webhook_url` varchar(500) DEFAULT NULL,
  `retry_count` int DEFAULT '0' COMMENT '重试次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `task_id` (`task_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_submit_time` (`submit_time`),
  KEY `fk_mj_generation` (`generation_id`),
  CONSTRAINT `fk_mj_generation` FOREIGN KEY (`generation_id`) REFERENCES `image_generations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mj_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=129 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Midjourney任务队列';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migrations_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `migration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_migration_name` (`migration_name`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库迁移历史';
/*!40101 SET character_set_client = @saved_cs_client */;
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
  KEY `idx_combination_order` (`combination_id`,`order_index`),
  CONSTRAINT `fk_combination_items_combination` FOREIGN KEY (`combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_combination_items_module` FOREIGN KEY (`module_id`) REFERENCES `knowledge_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=151 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块组合项关联表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块组合表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ocr_results` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `task_id` bigint NOT NULL COMMENT '任务ID',
  `page_number` int DEFAULT '1' COMMENT '页码(PDF多页)',
  `recognized_text` longtext COLLATE utf8mb4_unicode_ci COMMENT '识别的文本内容',
  `markdown_content` longtext COLLATE utf8mb4_unicode_ci COMMENT 'Markdown格式内容',
  `confidence_score` float DEFAULT NULL COMMENT '置信度分数',
  `language` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'zh' COMMENT '识别语言',
  `has_tables` tinyint(1) DEFAULT '0' COMMENT '是否包含表格',
  `has_images` tinyint(1) DEFAULT '0' COMMENT '是否包含图片',
  `metadata` json DEFAULT NULL COMMENT '其他元数据',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_page_number` (`page_number`),
  CONSTRAINT `ocr_results_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `ocr_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR识别结果表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ocr_tasks` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `task_type` enum('image','pdf','batch') COLLATE utf8mb4_unicode_ci DEFAULT 'image' COMMENT '任务类型',
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原始文件名',
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文件存储路径',
  `file_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文件URL',
  `file_size` bigint DEFAULT NULL COMMENT '文件大小(字节)',
  `file_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文件MIME类型',
  `page_count` int DEFAULT '1' COMMENT 'PDF页数',
  `status` enum('pending','processing','completed','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '任务状态',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `credits_consumed` decimal(10,2) DEFAULT '0.00' COMMENT '消耗积分',
  `processing_time` int DEFAULT NULL COMMENT '处理时长(毫秒)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `ocr_tasks_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR任务表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `org_applications` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `org_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业/组织/学校名称',
  `applicant_email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '申请人邮箱',
  `business_license` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '营业执照文件路径',
  `custom_field_4` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段4',
  `custom_field_5` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段5',
  `custom_field_6` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段6',
  `invitation_code_id` bigint DEFAULT NULL COMMENT '使用的邀请码ID',
  `referrer_info` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '推荐来源信息',
  `status` enum('pending','approved','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '申请状态',
  `approved_at` datetime DEFAULT NULL COMMENT '审批时间',
  `approved_by` bigint DEFAULT NULL COMMENT '审批人ID',
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '拒绝原因',
  `created_user_id` bigint DEFAULT NULL COMMENT '创建的用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_email` (`applicant_email`),
  KEY `idx_invitation_code` (`invitation_code_id`),
  KEY `idx_approved_by` (`approved_by`),
  KEY `idx_created_user` (`created_user_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_org_applications_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_org_applications_invitation` FOREIGN KEY (`invitation_code_id`) REFERENCES `invitation_codes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_org_applications_user` FOREIGN KEY (`created_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机构申请表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `oss_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` enum('aliyun','tencent','qiniu','aws','minio') COLLATE utf8mb4_unicode_ci NOT NULL,
  `access_key` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `secret_key` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bucket_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `region` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cdn_domain` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '0',
  `is_default` tinyint(1) DEFAULT '0',
  `max_file_size_mb` int DEFAULT '100',
  `allowed_file_types` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_provider` (`provider`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_is_default` (`is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
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
) ENGINE=InnoDB AUTO_INCREMENT=61 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户权限表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `smart_app_categories` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '分类ID',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类名称',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1677ff' COMMENT '分类颜色(HEX)',
  `icon` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '分类图标',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否激活',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='智能应用分类表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `smart_apps` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '应用ID',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '应用名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '应用描述',
  `icon` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '应用图标URL',
  `system_prompt` text COLLATE utf8mb4_unicode_ci COMMENT '系统级提示词',
  `temperature` decimal(2,1) DEFAULT '0.7' COMMENT 'AI温度参数(0.0-1.0)',
  `context_length` int DEFAULT '10' COMMENT '上下文条数(0-1000)',
  `model_id` bigint NOT NULL COMMENT '关联的AI模型ID',
  `is_stream` tinyint(1) DEFAULT '1' COMMENT '是否流式输出(1是/0否)',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '应用分类',
  `is_published` tinyint(1) DEFAULT '0' COMMENT '是否发布(1已发布/0未发布)',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序(越小越靠前)',
  `use_count` int DEFAULT '0' COMMENT '使用次数统计',
  `creator_id` bigint NOT NULL COMMENT '创建者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `credits_per_use` int DEFAULT '0' COMMENT '每次使用扣减积分(0-9999)',
  `category_ids` json DEFAULT NULL COMMENT '分类ID数组(支持1-3个)',
  PRIMARY KEY (`id`),
  KEY `idx_is_published` (`is_published`),
  KEY `idx_category` (`category`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_model_id` (`model_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='智能应用表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `storage_credit_config` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `action_type` varchar(50) NOT NULL COMMENT '操作类型: upload, download, share',
  `file_type` varchar(50) DEFAULT 'default' COMMENT '文件类型: image, video, document, default',
  `credits_per_mb` decimal(10,2) DEFAULT '1.00' COMMENT '每MB消耗积分',
  `min_credits` int DEFAULT '1' COMMENT '最小消耗积分',
  `max_credits` int DEFAULT '100' COMMENT '最大消耗积分',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_action_file_type` (`action_type`,`file_type`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='存储操作积分配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `storage_credits_config_simple` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `base_credits` int DEFAULT '2' COMMENT '基础积分（每次上传最少扣除）',
  `credits_per_5mb` decimal(10,2) DEFAULT '1.00' COMMENT '每5MB额外扣除积分',
  `max_file_size` int DEFAULT '100' COMMENT '最大文件大小（MB）',
  `is_active` tinyint(1) DEFAULT '1',
  `updated_by` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='简化的存储积分配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_modules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名称',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模块描述',
  `module_type` enum('frontend','backend','fullstack') COLLATE utf8mb4_unicode_ci DEFAULT 'fullstack' COMMENT '模块类型',
  `module_category` enum('system','external') COLLATE utf8mb4_unicode_ci DEFAULT 'external' COMMENT '模块类别：system-系统内置，external-外部扩展',
  `api_endpoint` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API端点地址',
  `frontend_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前端访问地址',
  `module_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模块访问URL',
  `route_path` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '系统模块的前端路由路径',
  `open_mode` enum('iframe','new_tab') COLLATE utf8mb4_unicode_ci DEFAULT 'new_tab' COMMENT '打开方式：iframe嵌入或新标签页',
  `menu_icon` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'AppstoreOutlined' COMMENT '菜单图标（Ant Design图标名称）',
  `proxy_path` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '代理路径',
  `auth_mode` enum('jwt','oauth','none') COLLATE utf8mb4_unicode_ci DEFAULT 'jwt' COMMENT '认证模式',
  `is_active` tinyint(1) DEFAULT '0' COMMENT '是否启用',
  `can_disable` tinyint(1) DEFAULT '1' COMMENT '是否可以禁用：0-不可禁用（核心模块），1-可以禁用',
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
  KEY `idx_active_sort` (`is_active`,`sort_order`),
  KEY `idx_category_active` (`module_category`,`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统模块配置表 - 支持外部应用集成';
/*!40101 SET character_set_client = @saved_cs_client */;
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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置键',
  `setting_value` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '配置值（支持大型HTML内容）',
  `setting_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'string' COMMENT '配置类型',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '配置说明',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_key` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=1588 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_global_authorizations` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `group_id` bigint NOT NULL COMMENT '用户组ID',
  `config_data` json NOT NULL COMMENT '授权配置数据（JSON格式）',
  `created_by` bigint NOT NULL COMMENT '创建者用户ID',
  `updated_by` bigint NOT NULL COMMENT '最后更新者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_id` (`group_id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_updated_by` (`updated_by`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_global_auth_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_global_auth_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_global_auth_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=85 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块全局授权配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_global_authorizations_backup_20251109_122011` (
  `id` bigint NOT NULL DEFAULT '0' COMMENT '主键ID',
  `group_id` bigint NOT NULL COMMENT '用户组ID',
  `config_data` json NOT NULL COMMENT '授权配置数据（JSON格式）',
  `created_by` bigint NOT NULL COMMENT '创建者用户ID',
  `updated_by` bigint NOT NULL COMMENT '最后更新者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_lesson_drafts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `lesson_id` bigint DEFAULT NULL COMMENT '关联的课程ID（NULL表示新建未保存）',
  `user_id` bigint NOT NULL COMMENT '编辑者用户ID',
  `draft_content` json NOT NULL COMMENT '草稿内容（格式同teaching_lessons.content）',
  `draft_title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '草稿标题',
  `auto_saved` tinyint(1) DEFAULT '1' COMMENT '是否自动保存',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lesson_id` (`lesson_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_updated_at` (`updated_at`),
  KEY `idx_user_lesson` (`user_id`,`lesson_id`),
  CONSTRAINT `fk_drafts_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `teaching_lessons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_drafts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学课程草稿表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_lesson_plans` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '教案ID',
  `lesson_id` bigint NOT NULL COMMENT '关联的课程ID',
  `page_number` int NOT NULL DEFAULT '1' COMMENT '页面序号（从1开始）',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '教案HTML内容（TinyMCE生成）',
  `creator_id` bigint NOT NULL COMMENT '创建者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_lesson_page` (`lesson_id`,`page_number`),
  KEY `idx_lesson_page` (`lesson_id`,`page_number`),
  KEY `idx_creator` (`creator_id`),
  KEY `idx_updated` (`updated_at`),
  CONSTRAINT `fk_lesson_plans_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_lesson_plans_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `teaching_lessons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='课程教案表 - 存储每个课程页面的教学设计';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_lessons` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `module_id` bigint NOT NULL COMMENT '所属教学模块ID',
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '课程标题',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '课程描述',
  `cover_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '课程封面图URL',
  `materials` json DEFAULT NULL COMMENT '课程资料，最多5个链接',
  `content_type` enum('course','experiment','exercise','reference','teaching_plan','answer','guide','assessment') COLLATE utf8mb4_unicode_ci DEFAULT 'course' COMMENT '内容类型',
  `content` json NOT NULL COMMENT '课程内容JSON: {pages: [{pageNumber, title, html, css, javascript}]}',
  `page_count` int DEFAULT '1' COMMENT '总页数',
  `creator_id` bigint NOT NULL COMMENT '创建者用户ID',
  `status` enum('draft','published','archived') COLLATE utf8mb4_unicode_ci DEFAULT 'draft' COMMENT '状态',
  `order_index` int DEFAULT '0' COMMENT '在模块中的排序',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `published_at` timestamp NULL DEFAULT NULL COMMENT '发布时间',
  `is_deleted` tinyint(1) DEFAULT '0' COMMENT '是否已删除',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `deleted_by` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_content_type` (`content_type`),
  KEY `idx_status` (`status`),
  KEY `idx_is_deleted` (`is_deleted`),
  KEY `idx_order_index` (`order_index`),
  KEY `idx_module_status` (`module_id`,`status`,`is_deleted`),
  KEY `idx_module_type` (`module_id`,`content_type`,`is_deleted`),
  KEY `idx_module_order` (`module_id`,`order_index`),
  KEY `fk_teaching_lessons_deleter` (`deleted_by`),
  KEY `idx_has_materials` (((case when (`materials` is not null) then 1 else 0 end))),
  CONSTRAINT `fk_teaching_lessons_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_teaching_lessons_deleter` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_teaching_lessons_module` FOREIGN KEY (`module_id`) REFERENCES `teaching_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学课程页面表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_teaching_lessons_after_insert` AFTER INSERT ON `teaching_lessons` FOR EACH ROW BEGIN
  IF NEW.is_deleted = 0 THEN
    UPDATE teaching_modules 
    SET lesson_count = lesson_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.module_id;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_teaching_lessons_after_update` AFTER UPDATE ON `teaching_lessons` FOR EACH ROW BEGIN
  
  IF OLD.is_deleted = 0 AND NEW.is_deleted = 1 THEN
    UPDATE teaching_modules 
    SET lesson_count = GREATEST(0, lesson_count - 1),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.module_id;
  END IF;
  
  
  IF OLD.is_deleted = 1 AND NEW.is_deleted = 0 THEN
    UPDATE teaching_modules 
    SET lesson_count = lesson_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.module_id;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_teaching_lessons_after_delete` AFTER DELETE ON `teaching_lessons` FOR EACH ROW BEGIN
  IF OLD.is_deleted = 0 THEN
    UPDATE teaching_modules 
    SET lesson_count = GREATEST(0, lesson_count - 1),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.module_id;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_module_group_relations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `module_id` bigint NOT NULL COMMENT '教学模块ID',
  `group_id` bigint NOT NULL COMMENT '分组ID',
  `sort_order` int DEFAULT '0' COMMENT '模块在分组内的排序序号',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_group` (`module_id`,`group_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_group_sort` (`group_id`,`sort_order`),
  CONSTRAINT `fk_module_group_group` FOREIGN KEY (`group_id`) REFERENCES `teaching_module_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_module_group_module` FOREIGN KEY (`module_id`) REFERENCES `teaching_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块分组关系表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_module_groups` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分组名称（如：小学1年级数学课程包）',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '分组描述',
  `sort_order` int DEFAULT '0' COMMENT '排序序号（数字越小越靠前）',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `visibility` enum('public','group','private') COLLATE utf8mb4_unicode_ci DEFAULT 'public' COMMENT '可见性（预留）',
  `owner_group_id` bigint DEFAULT NULL COMMENT '所属组织ID（预留）',
  `created_by` bigint NOT NULL COMMENT '创建者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_owner_group_id` (`owner_group_id`),
  CONSTRAINT `fk_teaching_groups_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_teaching_groups_owner` FOREIGN KEY (`owner_group_id`) REFERENCES `user_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块分组表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_modules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名称',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '模块描述',
  `cover_image` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '封面图片URL（云盘链接）',
  `creator_id` bigint NOT NULL COMMENT '创建者用户ID',
  `owner_group_id` bigint DEFAULT NULL COMMENT '所属组织ID（NULL表示平台级）',
  `visibility` enum('public','group','private') COLLATE utf8mb4_unicode_ci DEFAULT 'private' COMMENT '可见性：public-公开，group-组织内，private-私有',
  `status` enum('draft','published','archived') COLLATE utf8mb4_unicode_ci DEFAULT 'draft' COMMENT '状态：草稿/已发布/已归档',
  `order_index` int DEFAULT '0' COMMENT '排序序号',
  `lesson_count` int DEFAULT '0' COMMENT '课程数量',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `published_at` timestamp NULL DEFAULT NULL COMMENT '发布时间',
  `is_deleted` tinyint(1) DEFAULT '0' COMMENT '是否已删除',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `deleted_by` bigint DEFAULT NULL COMMENT '删除者用户ID',
  PRIMARY KEY (`id`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_owner_group_id` (`owner_group_id`),
  KEY `idx_visibility` (`visibility`),
  KEY `idx_status` (`status`),
  KEY `idx_is_deleted` (`is_deleted`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_order_index` (`order_index`),
  KEY `idx_creator_status` (`creator_id`,`status`,`is_deleted`),
  KEY `idx_group_status` (`owner_group_id`,`status`,`is_deleted`),
  KEY `fk_teaching_modules_deleter` (`deleted_by`),
  CONSTRAINT `fk_teaching_modules_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_teaching_modules_deleter` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_teaching_modules_group` FOREIGN KEY (`owner_group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_permissions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `module_id` bigint NOT NULL COMMENT '教学模块ID',
  `lesson_id` bigint DEFAULT NULL COMMENT '课程ID（NULL表示模块级权限）',
  `user_id` bigint DEFAULT NULL COMMENT '授权给特定用户（优先级最高）',
  `group_id` bigint DEFAULT NULL COMMENT '授权给组织（该组织所有成员）',
  `tag_id` bigint DEFAULT NULL COMMENT '授权给标签用户（拥有该标签的所有用户）',
  `permission_type` enum('edit','view_lesson','view_plan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'view_lesson' COMMENT '权限类型：view_lesson-查看课程，view_plan-查看教案，edit-编辑',
  `granted_by` bigint NOT NULL COMMENT '授权人用户ID',
  `granted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间',
  `expires_at` timestamp NULL DEFAULT NULL COMMENT '过期时间（NULL表示永久）',
  `note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '授权备注',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_lesson_user_type` (`module_id`,`lesson_id`,`user_id`,`permission_type`),
  UNIQUE KEY `uk_module_lesson_group_type` (`module_id`,`lesson_id`,`group_id`,`permission_type`),
  UNIQUE KEY `uk_module_lesson_tag_type` (`module_id`,`lesson_id`,`tag_id`,`permission_type`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_tag_id` (`tag_id`),
  KEY `idx_granted_by` (`granted_by`),
  KEY `idx_permission_type` (`permission_type`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_module_permission` (`module_id`,`permission_type`),
  KEY `idx_lesson_id` (`lesson_id`),
  KEY `idx_module_lesson` (`module_id`,`lesson_id`),
  CONSTRAINT `fk_teaching_permissions_granter` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_teaching_permissions_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_teaching_permissions_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `teaching_lessons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_teaching_permissions_module` FOREIGN KEY (`module_id`) REFERENCES `teaching_modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_teaching_permissions_tag` FOREIGN KEY (`tag_id`) REFERENCES `user_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_teaching_permissions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_permission_target` CHECK ((((`user_id` is not null) and (`group_id` is null) and (`tag_id` is null)) or ((`user_id` is null) and (`group_id` is not null) and (`tag_id` is null)) or ((`user_id` is null) and (`group_id` is null) and (`tag_id` is not null))))
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块权限表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_permissions_backup_20251031` (
  `id` bigint NOT NULL DEFAULT '0',
  `module_id` bigint NOT NULL COMMENT '教学模块ID',
  `lesson_id` bigint DEFAULT NULL COMMENT '课程ID（NULL表示模块级权限）',
  `user_id` bigint DEFAULT NULL COMMENT '授权给特定用户（优先级最高）',
  `group_id` bigint DEFAULT NULL COMMENT '授权给组织（该组织所有成员）',
  `tag_id` bigint DEFAULT NULL COMMENT '授权给标签用户（拥有该标签的所有用户）',
  `permission_type` enum('edit','view_lesson','view_plan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'view_lesson' COMMENT '权限类型：view_lesson-查看课程，view_plan-查看教案，edit-编辑',
  `granted_by` bigint NOT NULL COMMENT '授权人用户ID',
  `granted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间',
  `expires_at` timestamp NULL DEFAULT NULL COMMENT '过期时间（NULL表示永久）',
  `note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '授权备注'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teaching_view_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `module_id` bigint NOT NULL COMMENT '模块ID',
  `lesson_id` bigint DEFAULT NULL COMMENT '课程ID（NULL表示只看了模块列表）',
  `page_number` int DEFAULT '1' COMMENT '查看的页码',
  `duration` int DEFAULT '0' COMMENT '停留时长（秒）',
  `is_completed` tinyint(1) DEFAULT '0' COMMENT '是否看完整个课程',
  `viewed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '查看时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_lesson_id` (`lesson_id`),
  KEY `idx_viewed_at` (`viewed_at`),
  KEY `idx_user_module` (`user_id`,`module_id`),
  KEY `idx_user_lesson` (`user_id`,`lesson_id`),
  CONSTRAINT `fk_view_logs_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `teaching_lessons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_view_logs_module` FOREIGN KEY (`module_id`) REFERENCES `teaching_modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_view_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=731 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学浏览记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
) ENGINE=InnoDB AUTO_INCREMENT=4685 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_files` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `uploaded_by` bigint DEFAULT NULL COMMENT '上传者ID',
  `folder_id` bigint DEFAULT NULL COMMENT '所属文件夹',
  `original_name` varchar(255) NOT NULL COMMENT '原始文件名',
  `stored_name` varchar(255) NOT NULL COMMENT 'OSS存储名',
  `oss_key` varchar(500) NOT NULL COMMENT 'OSS对象键',
  `oss_url` text COMMENT 'OSS访问URL',
  `file_size` bigint NOT NULL COMMENT '文件大小(字节)',
  `mime_type` varchar(100) DEFAULT NULL COMMENT 'MIME类型',
  `file_ext` varchar(20) DEFAULT NULL COMMENT '文件扩展名',
  `thumbnail_url` text COMMENT '缩略图URL',
  `is_public` tinyint(1) DEFAULT '0' COMMENT '是否公开',
  `download_count` int DEFAULT '0' COMMENT '下载次数',
  `is_deleted` tinyint(1) DEFAULT '0' COMMENT '软删除标记',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_folder` (`user_id`,`folder_id`),
  KEY `idx_oss_key` (`oss_key`),
  KEY `idx_created_at` (`created_at`),
  KEY `fk_user_files_folder` (`folder_id`),
  KEY `idx_is_deleted` (`is_deleted`),
  KEY `idx_uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_user_files_folder` FOREIGN KEY (`folder_id`) REFERENCES `user_folders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_user_files_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_user_files_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=187 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户文件表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_folders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `parent_id` bigint DEFAULT NULL COMMENT '父文件夹ID',
  `folder_type` enum('personal','global','group') DEFAULT 'personal' COMMENT '文件夹类型',
  `group_id` bigint DEFAULT NULL COMMENT '组织ID（仅组织文件夹）',
  `name` varchar(255) NOT NULL COMMENT '文件夹名称',
  `path` text COMMENT '完整路径',
  `is_deleted` tinyint(1) DEFAULT '0' COMMENT '软删除标记',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_parent` (`user_id`,`parent_id`),
  KEY `idx_path` (`path`(255)),
  KEY `fk_user_folders_parent` (`parent_id`),
  KEY `idx_is_deleted` (`is_deleted`),
  KEY `idx_folder_type` (`folder_type`),
  KEY `idx_group_id` (`group_id`),
  CONSTRAINT `fk_user_folders_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_folders_parent` FOREIGN KEY (`parent_id`) REFERENCES `user_folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_folders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户文件夹表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
  `invitation_enabled` tinyint(1) DEFAULT '0' COMMENT '是否启用邀请码',
  `invitation_code` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邀请码（5位英文数字）',
  `invitation_usage_count` int DEFAULT '0' COMMENT '邀请码使用次数',
  `invitation_max_uses` int DEFAULT NULL COMMENT '邀请码最大使用次数（NULL表示无限制）',
  `invitation_expire_at` timestamp NULL DEFAULT NULL COMMENT '邀请码过期时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_name` (`name`),
  UNIQUE KEY `uk_invitation_code` (`invitation_code`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_credits_pool` (`credits_pool`,`credits_pool_used`),
  KEY `idx_site_customization` (`site_customization_enabled`),
  KEY `idx_invitation_code` (`invitation_code`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户分组表（支持独立站点配置）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_mindmaps` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '思维导图标题',
  `content` longtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Markdown内容',
  `content_type` enum('markdown','mermaid','svg') COLLATE utf8mb4_unicode_ci DEFAULT 'markdown' COMMENT '内容类型：markdown=思维导图, mermaid=流程图, svg=矢量图',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_updated_at` (`updated_at`),
  CONSTRAINT `fk_mindmap_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户思维导图表';
/*!40101 SET character_set_client = @saved_cs_client */;
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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_sessions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `session_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_activity_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_last_activity` (`last_activity_at`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_smart_app_favorites` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `smart_app_id` bigint NOT NULL COMMENT '智能应用ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_app` (`user_id`,`smart_app_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_smart_app_id` (`smart_app_id`),
  CONSTRAINT `fk_favorite_app` FOREIGN KEY (`smart_app_id`) REFERENCES `smart_apps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_favorite_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户智能应用收藏表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_storage` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `storage_quota` bigint DEFAULT '10737418240' COMMENT '存储配额(字节) 默认10GB',
  `storage_used` bigint DEFAULT '0' COMMENT '已使用存储(字节)',
  `file_count` int DEFAULT '0' COMMENT '文件数量',
  `folder_count` int DEFAULT '0' COMMENT '文件夹数量',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_id` (`user_id`),
  CONSTRAINT `fk_user_storage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户存储统计表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_tag_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `tag_id` bigint NOT NULL,
  `action` enum('add','remove') NOT NULL,
  `operator_id` bigint NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_history` (`user_id`,`created_at`),
  KEY `idx_tag_history` (`tag_id`,`created_at`),
  KEY `idx_operator` (`operator_id`),
  CONSTRAINT `user_tag_history_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_tag_history_ibfk_2` FOREIGN KEY (`tag_id`) REFERENCES `user_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_tag_history_ibfk_3` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='标签操作历史记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_tag_relations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `tag_id` bigint NOT NULL COMMENT '标签ID',
  `assigned_by` bigint DEFAULT NULL COMMENT '分配者用户ID',
  `assigned_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '分配时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_tag` (`user_id`,`tag_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_tag_id` (`tag_id`),
  KEY `idx_assigned_by` (`assigned_by`),
  KEY `idx_assigned_at` (`assigned_at`),
  KEY `idx_user_tag` (`user_id`,`tag_id`),
  KEY `idx_tag_user` (`tag_id`,`user_id`),
  CONSTRAINT `fk_tag_relations_assigner` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tag_relations_tag` FOREIGN KEY (`tag_id`) REFERENCES `user_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tag_relations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户标签关系表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_tags` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `group_id` bigint NOT NULL COMMENT '所属用户组ID',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签名称',
  `color` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '#1677ff' COMMENT '标签颜色',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '标签描述',
  `icon` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '图标名称',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_by` bigint DEFAULT NULL COMMENT '创建者用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_tag_name` (`group_id`,`name`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_sort_order` (`sort_order`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_group_active` (`group_id`,`is_active`),
  CONSTRAINT `fk_user_tags_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_user_tags_group` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户标签定义表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `uuid` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uuid_source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'system' COMMENT '标识来源：system/sso',
  `sso_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `username` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户名',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '加密密码',
  `role` enum('super_admin','admin','user') COLLATE utf8mb4_unicode_ci DEFAULT 'user' COMMENT '用户角色',
  `group_id` bigint DEFAULT NULL COMMENT '用户分组ID',
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '用户状态',
  `remark` text COLLATE utf8mb4_unicode_ci COMMENT '管理员备注',
  `can_view_chat_history` tinyint(1) DEFAULT '0' COMMENT '组管理员是否可查看组员对话记录：0-不可查看，1-可查看',
  `tag_count` int DEFAULT '0' COMMENT '标签数量',
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
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '软删除时间（NULL=未删除）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `uuid` (`uuid`),
  UNIQUE KEY `uuid_2` (`uuid`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`),
  KEY `idx_username` (`username`),
  KEY `idx_role` (`role`),
  KEY `idx_status` (`status`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_credits_quota` (`credits_quota`),
  KEY `idx_used_credits` (`used_credits`),
  KEY `idx_credits_expire` (`credits_expire_at`),
  KEY `idx_expire_at` (`expire_at`),
  KEY `idx_uuid` (`uuid`),
  KEY `idx_uuid_source` (`uuid_source`),
  KEY `idx_sso_id` (`sso_id`),
  KEY `idx_tag_count` (`tag_count`),
  KEY `idx_deleted_at` (`deleted_at`),
  FULLTEXT KEY `idx_remark` (`remark`)
) ENGINE=InnoDB AUTO_INCREMENT=707 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表 - 包含账号有效期和积分有效期';
/*!40101 SET character_set_client = @saved_cs_client */;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_teaching_permission_hierarchy` AS SELECT 
 1 AS `id`,
 1 AS `module_id`,
 1 AS `lesson_id`,
 1 AS `user_id`,
 1 AS `group_id`,
 1 AS `tag_id`,
 1 AS `permission_type`,
 1 AS `permission_level`,
 1 AS `granted_by`,
 1 AS `granted_at`,
 1 AS `expires_at`*/;
SET character_set_client = @saved_cs_client;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_user_accessible_teaching_modules` AS SELECT 
 1 AS `module_id`,
 1 AS `module_name`,
 1 AS `description`,
 1 AS `cover_image`,
 1 AS `creator_id`,
 1 AS `owner_group_id`,
 1 AS `visibility`,
 1 AS `status`,
 1 AS `lesson_count`,
 1 AS `view_count`,
 1 AS `created_at`,
 1 AS `updated_at`,
 1 AS `user_id`,
 1 AS `username`,
 1 AS `user_group_id`,
 1 AS `creator_name`,
 1 AS `user_permission`,
 1 AS `is_creator`,
 1 AS `is_admin`*/;
SET character_set_client = @saved_cs_client;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_user_tags_detail` AS SELECT 
 1 AS `relation_id`,
 1 AS `user_id`,
 1 AS `username`,
 1 AS `email`,
 1 AS `user_group_id`,
 1 AS `tag_id`,
 1 AS `tag_name`,
 1 AS `tag_color`,
 1 AS `tag_description`,
 1 AS `tag_icon`,
 1 AS `tag_group_id`,
 1 AS `group_name`,
 1 AS `assigned_at`,
 1 AS `assigned_by`,
 1 AS `assigned_by_username`*/;
SET character_set_client = @saved_cs_client;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `video_generations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `model_id` bigint NOT NULL COMMENT '模型ID',
  `prompt` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提示词',
  `negative_prompt` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '负面提示词',
  `first_frame_image` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '首帧图片URL',
  `last_frame_image` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '尾帧图片URL',
  `generation_mode` enum('text_to_video','image_to_video','first_frame','last_frame','first_last_frame') COLLATE utf8mb4_unicode_ci DEFAULT 'text_to_video' COMMENT '生成模式',
  `resolution` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分辨率',
  `duration` int NOT NULL COMMENT '时长（秒）',
  `fps` int DEFAULT '24' COMMENT '帧率',
  `ratio` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '16:9' COMMENT '宽高比',
  `seed` int DEFAULT '-1' COMMENT '随机种子',
  `watermark` tinyint(1) DEFAULT '0' COMMENT '是否添加水印',
  `camera_fixed` tinyint(1) DEFAULT '0' COMMENT '是否固定摄像头',
  `task_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '火山方舟任务ID',
  `status` enum('pending','submitted','queued','running','succeeded','failed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT '0' COMMENT '生成进度（0-100）',
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `video_url` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始视频URL（火山方舟返回）',
  `local_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地/OSS存储路径',
  `thumbnail_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缩略图路径',
  `preview_gif_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '预览GIF路径',
  `last_frame_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '尾帧图片路径',
  `file_size` bigint DEFAULT NULL COMMENT '文件大小（字节）',
  `video_width` int DEFAULT NULL COMMENT '视频宽度',
  `video_height` int DEFAULT NULL COMMENT '视频高度',
  `video_duration` float DEFAULT NULL COMMENT '实际视频时长（秒）',
  `credits_consumed` decimal(10,2) DEFAULT '0.00' COMMENT '消耗积分',
  `generation_time` int DEFAULT NULL COMMENT '生成耗时（秒）',
  `is_favorite` tinyint(1) DEFAULT '0' COMMENT '是否收藏',
  `is_public` tinyint(1) DEFAULT '0' COMMENT '是否公开',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `download_count` int DEFAULT '0' COMMENT '下载次数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'kling' COMMENT '视频提供商: kling, sora2_goapi',
  `orientation` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '方向: portrait, landscape, square',
  `reference_images` text COLLATE utf8mb4_unicode_ci COMMENT '参考图片URL列表(JSON)',
  `generation_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '生成ID(如 gen_xxx)',
  `oss_video_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OSS存储的视频URL',
  `oss_thumbnail_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OSS存储的缩略图URL',
  `oss_gif_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OSS存储的GIF预览URL',
  `raw_response` longtext COLLATE utf8mb4_unicode_ci COMMENT '原始API响应JSON',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始生成时间',
  `download_attempted` tinyint(1) DEFAULT '0' COMMENT '是否尝试过下载到OSS',
  `download_failed_reason` text COLLATE utf8mb4_unicode_ci COMMENT 'OSS下载失败原因',
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_model` (`model_id`),
  KEY `idx_task` (`task_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_public` (`is_public`),
  KEY `idx_favorite` (`is_favorite`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_completed` (`completed_at`),
  KEY `idx_provider_status` (`provider`,`status`),
  KEY `idx_generation_id` (`generation_id`),
  KEY `idx_download_attempted` (`download_attempted`,`status`),
  CONSTRAINT `video_generations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `video_generations_ibfk_2` FOREIGN KEY (`model_id`) REFERENCES `video_models` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=239 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频生成历史表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `video_models` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型标识',
  `display_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名称',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '模型描述',
  `provider` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'volcano' COMMENT '提供商',
  `endpoint` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'API端点',
  `api_key` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '加密的API密钥',
  `model_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型ID',
  `generation_type` enum('sync','async') COLLATE utf8mb4_unicode_ci DEFAULT 'async' COMMENT '生成类型',
  `api_config` json DEFAULT NULL COMMENT 'API配置（webhook等）',
  `supports_text_to_video` tinyint(1) DEFAULT '1' COMMENT '支持文生视频',
  `supports_image_to_video` tinyint(1) DEFAULT '0' COMMENT '支持图生视频',
  `supports_first_frame` tinyint(1) DEFAULT '0' COMMENT '支持首帧图生视频',
  `supports_last_frame` tinyint(1) DEFAULT '0' COMMENT '支持尾帧图生视频',
  `resolutions_supported` json DEFAULT NULL COMMENT '支持的分辨率列表',
  `durations_supported` json DEFAULT NULL COMMENT '支持的时长列表（秒）',
  `fps_supported` json DEFAULT NULL COMMENT '支持的帧率列表',
  `ratios_supported` json DEFAULT NULL COMMENT '支持的宽高比列表',
  `max_prompt_length` int DEFAULT '500' COMMENT '最大提示词长度',
  `default_resolution` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '720p' COMMENT '默认分辨率',
  `default_duration` int DEFAULT '5' COMMENT '默认时长（秒）',
  `default_fps` int DEFAULT '24' COMMENT '默认帧率',
  `default_ratio` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '16:9' COMMENT '默认宽高比',
  `base_price` decimal(10,2) DEFAULT '50.00' COMMENT '基础价格（积分）',
  `price_config` json DEFAULT NULL COMMENT '价格配置（分辨率和时长系数）',
  `example_prompt` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '示例提示词',
  `example_video` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '示例视频URL',
  `icon` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'VideoCameraOutlined' COMMENT '图标',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `sort_order` int DEFAULT '0' COMMENT '排序',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_active` (`is_active`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频生成模型配置表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wiki_editors` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `wiki_id` bigint NOT NULL COMMENT '知识库条目ID',
  `user_id` bigint NOT NULL COMMENT '编辑者用户ID',
  `added_by` bigint NOT NULL COMMENT '添加者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wiki_user` (`wiki_id`,`user_id`),
  KEY `added_by` (`added_by`),
  KEY `idx_wiki_id` (`wiki_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `wiki_editors_ibfk_1` FOREIGN KEY (`wiki_id`) REFERENCES `wiki_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wiki_editors_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wiki_editors_ibfk_3` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库协作编辑者表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wiki_items` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `title` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题（必填）',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '描述',
  `content` longtext COLLATE utf8mb4_unicode_ci COMMENT '内容（纯文本）',
  `notes` json DEFAULT NULL COMMENT '备注数组，最多10条',
  `links` json DEFAULT NULL COMMENT '相关链接数组，最多10条，每条{title,url}',
  `scope` enum('personal','team','global') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'personal' COMMENT '范围：personal个人/team团队/global全局',
  `creator_id` bigint NOT NULL COMMENT '创建者ID',
  `group_id` bigint DEFAULT NULL COMMENT '团队知识库所属组ID（scope=team时必填）',
  `is_pinned` tinyint(1) DEFAULT '0' COMMENT '是否置顶',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `current_version` int DEFAULT '1' COMMENT '当前版本号',
  `version_count` int DEFAULT '1' COMMENT '总版本数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_scope` (`scope`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_is_pinned` (`is_pinned`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_scope_group` (`scope`,`group_id`),
  CONSTRAINT `wiki_items_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wiki_items_ibfk_2` FOREIGN KEY (`group_id`) REFERENCES `user_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库主表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wiki_versions` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `wiki_id` bigint NOT NULL COMMENT '知识库条目ID',
  `version_number` int NOT NULL COMMENT '版本号',
  `title` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题快照',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '描述快照',
  `content` longtext COLLATE utf8mb4_unicode_ci COMMENT '内容快照',
  `notes_snapshot` json DEFAULT NULL COMMENT '备注快照',
  `links_snapshot` json DEFAULT NULL COMMENT '链接快照',
  `change_summary` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '版本说明（可选）',
  `created_by` bigint NOT NULL COMMENT '保存者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wiki_version` (`wiki_id`,`version_number`),
  KEY `idx_wiki_id` (`wiki_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `wiki_versions_ibfk_1` FOREIGN KEY (`wiki_id`) REFERENCES `wiki_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wiki_versions_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库版本表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50001 DROP VIEW IF EXISTS `v_teaching_permission_hierarchy`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`ai_user`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `v_teaching_permission_hierarchy` AS select `tp`.`id` AS `id`,`tp`.`module_id` AS `module_id`,`tp`.`lesson_id` AS `lesson_id`,`tp`.`user_id` AS `user_id`,`tp`.`group_id` AS `group_id`,`tp`.`tag_id` AS `tag_id`,`tp`.`permission_type` AS `permission_type`,(case when (`tp`.`permission_type` = 'edit') then 3 when (`tp`.`permission_type` = 'view_plan') then 2 when (`tp`.`permission_type` = 'view_lesson') then 1 end) AS `permission_level`,`tp`.`granted_by` AS `granted_by`,`tp`.`granted_at` AS `granted_at`,`tp`.`expires_at` AS `expires_at` from `teaching_permissions` `tp` where ((`tp`.`expires_at` is null) or (`tp`.`expires_at` > now())) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_user_accessible_teaching_modules`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `v_user_accessible_teaching_modules` AS select distinct `tm`.`id` AS `module_id`,`tm`.`name` AS `module_name`,`tm`.`description` AS `description`,`tm`.`cover_image` AS `cover_image`,`tm`.`creator_id` AS `creator_id`,`tm`.`owner_group_id` AS `owner_group_id`,`tm`.`visibility` AS `visibility`,`tm`.`status` AS `status`,`tm`.`lesson_count` AS `lesson_count`,`tm`.`view_count` AS `view_count`,`tm`.`created_at` AS `created_at`,`tm`.`updated_at` AS `updated_at`,`u`.`id` AS `user_id`,`u`.`username` AS `username`,`u`.`group_id` AS `user_group_id`,`creator`.`username` AS `creator_name`,(case when (`tp_user`.`permission_type` is not null) then `tp_user`.`permission_type` when (`tp_group`.`permission_type` is not null) then `tp_group`.`permission_type` when (`tp_tag`.`permission_type` is not null) then `tp_tag`.`permission_type` else 'view' end) AS `user_permission`,(`u`.`id` = `tm`.`creator_id`) AS `is_creator`,(`u`.`role` in ('super_admin','admin')) AS `is_admin` from (((((`teaching_modules` `tm` join `users` `u`) left join `users` `creator` on((`tm`.`creator_id` = `creator`.`id`))) left join `teaching_permissions` `tp_user` on(((`tm`.`id` = `tp_user`.`module_id`) and (`tp_user`.`user_id` = `u`.`id`) and ((`tp_user`.`expires_at` is null) or (`tp_user`.`expires_at` > now()))))) left join `teaching_permissions` `tp_group` on(((`tm`.`id` = `tp_group`.`module_id`) and (`tp_group`.`group_id` = `u`.`group_id`) and ((`tp_group`.`expires_at` is null) or (`tp_group`.`expires_at` > now()))))) left join `teaching_permissions` `tp_tag` on(((`tm`.`id` = `tp_tag`.`module_id`) and `tp_tag`.`tag_id` in (select `user_tag_relations`.`tag_id` from `user_tag_relations` where (`user_tag_relations`.`user_id` = `u`.`id`)) and ((`tp_tag`.`expires_at` is null) or (`tp_tag`.`expires_at` > now()))))) where ((`tm`.`is_deleted` = 0) and (`u`.`deleted_at` is null) and ((`u`.`id` = `tm`.`creator_id`) or (`u`.`role` in ('super_admin','admin')) or (`tm`.`visibility` = 'public') or ((`tm`.`visibility` = 'group') and (`u`.`group_id` = `tm`.`owner_group_id`)) or (`tp_user`.`id` is not null) or (`tp_group`.`id` is not null) or (`tp_tag`.`id` is not null))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_user_tags_detail`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`ai_user`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `v_user_tags_detail` AS select `utr`.`id` AS `relation_id`,`utr`.`user_id` AS `user_id`,`u`.`username` AS `username`,`u`.`email` AS `email`,`u`.`group_id` AS `user_group_id`,`ut`.`id` AS `tag_id`,`ut`.`name` AS `tag_name`,`ut`.`color` AS `tag_color`,`ut`.`description` AS `tag_description`,`ut`.`icon` AS `tag_icon`,`ut`.`group_id` AS `tag_group_id`,`ug`.`name` AS `group_name`,`utr`.`assigned_at` AS `assigned_at`,`utr`.`assigned_by` AS `assigned_by`,`assigner`.`username` AS `assigned_by_username` from ((((`user_tag_relations` `utr` join `users` `u` on((`utr`.`user_id` = `u`.`id`))) join `user_tags` `ut` on((`utr`.`tag_id` = `ut`.`id`))) join `user_groups` `ug` on((`ut`.`group_id` = `ug`.`id`))) left join `users` `assigner` on((`utr`.`assigned_by` = `assigner`.`id`))) where (`ut`.`is_active` = 1) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

