-- =====================================================
-- 迁移脚本：企业机构申请系统（修复版）
-- 版本：047
-- 日期：2024-09-14
-- 描述：添加企业申请、邀请码管理等功能
-- =====================================================

-- 1. 创建邀请码管理表
CREATE TABLE IF NOT EXISTS `invitation_codes` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '6位邀请码',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注说明',
  `is_active` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `usage_limit` int DEFAULT -1 COMMENT '使用次数限制，-1表示无限',
  `used_count` int DEFAULT 0 COMMENT '已使用次数',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请码管理表';

-- 2. 创建机构申请表
CREATE TABLE IF NOT EXISTS `org_applications` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `org_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业/组织/学校名称',
  `applicant_email` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '申请人邮箱',
  `business_license` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '营业执照文件路径',
  `custom_field_4` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段4',
  `custom_field_5` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段5',
  `custom_field_6` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段6',
  `invitation_code_id` bigint DEFAULT NULL COMMENT '使用的邀请码ID',
  `referrer_info` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '推荐来源信息',
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '申请状态',
  `approved_at` datetime DEFAULT NULL COMMENT '审批时间',
  `approved_by` bigint DEFAULT NULL COMMENT '审批人ID',
  `rejection_reason` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
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
  CONSTRAINT `fk_org_applications_invitation` FOREIGN KEY (`invitation_code_id`) REFERENCES `invitation_codes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_org_applications_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_org_applications_user` FOREIGN KEY (`created_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机构申请表';

-- 3. 创建申请表单配置表
CREATE TABLE IF NOT EXISTS `application_form_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `button_text` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '申请企业账号' COMMENT '申请按钮文字',
  `button_visible` tinyint(1) DEFAULT 1 COMMENT '按钮是否显示',
  `field_4_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段4标签',
  `field_4_required` tinyint(1) DEFAULT 0 COMMENT '字段4是否必填',
  `field_4_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'text' COMMENT '字段4类型：text/textarea/select',
  `field_4_options` json DEFAULT NULL COMMENT '字段4选项（select类型）',
  `field_5_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段5标签',
  `field_5_required` tinyint(1) DEFAULT 0 COMMENT '字段5是否必填',
  `field_5_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'text' COMMENT '字段5类型',
  `field_5_options` json DEFAULT NULL COMMENT '字段5选项',
  `field_6_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自定义字段6标签',
  `field_6_required` tinyint(1) DEFAULT 0 COMMENT '字段6是否必填',
  `field_6_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'text' COMMENT '字段6类型',
  `field_6_options` json DEFAULT NULL COMMENT '字段6选项',
  `invitation_code_required` tinyint(1) DEFAULT 0 COMMENT '邀请码是否必填',
  `default_group_id` bigint DEFAULT 1 COMMENT '默认分配的用户组',
  `default_credits` int DEFAULT 0 COMMENT '默认积分',
  `auto_approve` tinyint(1) DEFAULT 0 COMMENT '是否自动审批',
  `email_notification` tinyint(1) DEFAULT 1 COMMENT '是否发送邮件通知',
  `updated_by` bigint DEFAULT NULL COMMENT '最后更新人',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_updated_by` (`updated_by`),
  CONSTRAINT `fk_form_config_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='申请表单配置表';

-- 4. 插入默认配置
INSERT INTO `application_form_config` (
  `button_text`, 
  `button_visible`,
  `field_4_label`,
  `field_4_required`,
  `field_5_label`,
  `field_5_required`,
  `field_6_label`,
  `field_6_required`,
  `invitation_code_required`,
  `default_group_id`,
  `default_credits`,
  `auto_approve`,
  `email_notification`
) VALUES (
  '申请企业账号',
  1,
  '联系人姓名',
  1,
  '联系电话',
  1,
  '申请说明',
  0,
  0,
  1,
  0,
  0,
  1
) ON DUPLICATE KEY UPDATE button_text = button_text;

-- 5. 插入示例邀请码（使用子查询获取超级管理员ID，如果没有则为NULL）
INSERT INTO `invitation_codes` (`code`, `description`, `is_active`, `usage_limit`, `created_by`) 
SELECT 
  'TEST01', '内部测试邀请码', 1, -1, 
  (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM invitation_codes WHERE code = 'TEST01');

INSERT INTO `invitation_codes` (`code`, `description`, `is_active`, `usage_limit`, `created_by`) 
SELECT 
  'EDU123', '教育机构专用', 1, 100, 
  (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM invitation_codes WHERE code = 'EDU123');

INSERT INTO `invitation_codes` (`code`, `description`, `is_active`, `usage_limit`, `created_by`) 
SELECT 
  'BIZ456', '企业合作伙伴', 1, 50, 
  (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM invitation_codes WHERE code = 'BIZ456');

-- 6. 记录迁移
INSERT INTO migration_history (migration_name, executed_at) 
VALUES ('047_add_org_application_system.sql', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
