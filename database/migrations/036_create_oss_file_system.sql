-- OSS文件管理系统数据库迁移
-- 创建时间: 2024-12-26

-- 1. 更新oss_config表（如果不存在则创建）
CREATE TABLE IF NOT EXISTS `oss_config` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `endpoint` VARCHAR(255) NOT NULL COMMENT 'OSS Endpoint',
  `access_key_id` TEXT NOT NULL COMMENT 'Access Key ID (加密存储)',
  `access_key_secret` TEXT NOT NULL COMMENT 'Access Key Secret (加密存储)',
  `bucket_name` VARCHAR(100) NOT NULL COMMENT 'Bucket名称',
  `bucket_domain` VARCHAR(255) COMMENT 'Bucket域名',
  `region` VARCHAR(50) DEFAULT 'oss-cn-hongkong' COMMENT 'OSS区域',
  `enable_cdn` TINYINT(1) DEFAULT 0 COMMENT '是否启用CDN',
  `cdn_domain` VARCHAR(255) COMMENT 'CDN域名',
  `enable_thumbnail` TINYINT(1) DEFAULT 1 COMMENT '是否启用缩略图',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OSS配置表';

-- 2. 创建用户存储统计表
CREATE TABLE IF NOT EXISTS `user_storage` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `storage_quota` BIGINT DEFAULT 10737418240 COMMENT '存储配额(字节) 默认10GB',
  `storage_used` BIGINT DEFAULT 0 COMMENT '已使用存储(字节)',
  `file_count` INT DEFAULT 0 COMMENT '文件数量',
  `folder_count` INT DEFAULT 0 COMMENT '文件夹数量',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_id` (`user_id`),
  CONSTRAINT `fk_user_storage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户存储统计表';

-- 3. 创建文件夹表
CREATE TABLE IF NOT EXISTS `user_folders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `parent_id` BIGINT DEFAULT NULL COMMENT '父文件夹ID',
  `name` VARCHAR(255) NOT NULL COMMENT '文件夹名称',
  `path` TEXT COMMENT '完整路径',
  `is_deleted` TINYINT(1) DEFAULT 0 COMMENT '软删除标记',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_parent` (`user_id`, `parent_id`),
  KEY `idx_path` (`path`(255)),
  CONSTRAINT `fk_user_folders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_folders_parent` FOREIGN KEY (`parent_id`) REFERENCES `user_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户文件夹表';

-- 4. 扩展files表为user_files
CREATE TABLE IF NOT EXISTS `user_files` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `folder_id` BIGINT DEFAULT NULL COMMENT '所属文件夹',
  `original_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `stored_name` VARCHAR(255) NOT NULL COMMENT 'OSS存储名',
  `oss_key` VARCHAR(500) NOT NULL COMMENT 'OSS对象键',
  `oss_url` TEXT COMMENT 'OSS访问URL',
  `file_size` BIGINT NOT NULL COMMENT '文件大小(字节)',
  `mime_type` VARCHAR(100) COMMENT 'MIME类型',
  `file_ext` VARCHAR(20) COMMENT '文件扩展名',
  `thumbnail_url` TEXT COMMENT '缩略图URL',
  `is_public` TINYINT(1) DEFAULT 0 COMMENT '是否公开',
  `download_count` INT DEFAULT 0 COMMENT '下载次数',
  `is_deleted` TINYINT(1) DEFAULT 0 COMMENT '软删除标记',
  `deleted_at` TIMESTAMP NULL COMMENT '删除时间',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_folder` (`user_id`, `folder_id`),
  KEY `idx_oss_key` (`oss_key`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_user_files_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_files_folder` FOREIGN KEY (`folder_id`) REFERENCES `user_folders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户文件表';

-- 5. 创建文件分享表
CREATE TABLE IF NOT EXISTS `file_shares` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL COMMENT '分享者',
  `file_id` BIGINT DEFAULT NULL COMMENT '文件ID',
  `folder_id` BIGINT DEFAULT NULL COMMENT '文件夹ID',
  `share_code` VARCHAR(32) UNIQUE NOT NULL COMMENT '分享码',
  `share_password` VARCHAR(20) COMMENT '访问密码',
  `expire_at` TIMESTAMP NULL COMMENT '过期时间',
  `view_count` INT DEFAULT 0 COMMENT '查看次数',
  `max_views` INT DEFAULT NULL COMMENT '最大查看次数',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否有效',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_share_code` (`share_code`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_file_shares_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_file_shares_file` FOREIGN KEY (`file_id`) REFERENCES `user_files` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_file_shares_folder` FOREIGN KEY (`folder_id`) REFERENCES `user_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件分享表';

-- 6. 创建文件操作积分配置表
CREATE TABLE IF NOT EXISTS `storage_credit_config` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `action_type` VARCHAR(50) NOT NULL COMMENT '操作类型: upload, download, share',
  `file_type` VARCHAR(50) DEFAULT 'default' COMMENT '文件类型: image, video, document, default',
  `credits_per_mb` DECIMAL(10,2) DEFAULT 1.00 COMMENT '每MB消耗积分',
  `min_credits` INT DEFAULT 1 COMMENT '最小消耗积分',
  `max_credits` INT DEFAULT 100 COMMENT '最大消耗积分',
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_action_file_type` (`action_type`, `file_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='存储操作积分配置';

-- 7. 插入默认积分配置
INSERT INTO `storage_credit_config` (`action_type`, `file_type`, `credits_per_mb`, `min_credits`, `max_credits`) VALUES
('upload', 'image', 0.5, 1, 50),
('upload', 'video', 2.0, 5, 200),
('upload', 'document', 0.3, 1, 30),
('upload', 'default', 1.0, 1, 100),
('download', 'default', 0.1, 0, 10),
('share', 'default', 0.5, 1, 20)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- 8. 添加索引优化查询性能
ALTER TABLE `user_files` ADD INDEX `idx_is_deleted` (`is_deleted`);
ALTER TABLE `user_folders` ADD INDEX `idx_is_deleted` (`is_deleted`);

-- 记录迁移
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('036_create_oss_file_system.sql', NOW());
