-- 创建文件表
-- 创建时间: 2025-01-16

CREATE TABLE IF NOT EXISTS `files` (
  `id` varchar(36) NOT NULL COMMENT '文件ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `filename` varchar(255) NOT NULL COMMENT '存储文件名',
  `original_name` varchar(255) NOT NULL COMMENT '原始文件名',
  `mime_type` varchar(100) NOT NULL COMMENT 'MIME类型',
  `size` bigint NOT NULL COMMENT '文件大小(字节)',
  `path` varchar(500) NOT NULL COMMENT '文件路径',
  `url` varchar(500) NOT NULL COMMENT '访问URL',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_files_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件上传记录表';

-- 提示信息
SELECT '文件表创建完成！' AS message;
