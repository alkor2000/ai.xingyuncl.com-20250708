-- Token黑名单表（可选，主要使用Redis）
CREATE TABLE IF NOT EXISTS `token_blacklist` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `token_jti` varchar(255) NOT NULL COMMENT 'JWT ID',
  `token_type` enum('access','refresh') NOT NULL DEFAULT 'access',
  `expires_at` datetime NOT NULL COMMENT 'Token过期时间',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token_jti` (`token_jti`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `fk_blacklist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token黑名单';

-- 定期清理过期token的存储过程
DELIMITER $$
CREATE PROCEDURE IF NOT EXISTS `cleanup_expired_tokens`()
BEGIN
  DELETE FROM token_blacklist WHERE expires_at < NOW();
END$$
DELIMITER ;

-- 创建定时事件，每天清理一次过期token
CREATE EVENT IF NOT EXISTS `daily_cleanup_expired_tokens`
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO CALL cleanup_expired_tokens();
