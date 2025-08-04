-- 补充迁移脚本：只创建缺失的表和索引

-- 检查并创建module_combination_items表
CREATE TABLE IF NOT EXISTS `module_combination_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `combination_id` bigint NOT NULL,
  `module_id` bigint NOT NULL,
  `order_index` int DEFAULT 0,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_combination_module` (`combination_id`, `module_id`),
  KEY `idx_combination_id` (`combination_id`),
  KEY `idx_module_id` (`module_id`),
  CONSTRAINT `fk_combination_items_combination` FOREIGN KEY (`combination_id`) REFERENCES `module_combinations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_combination_items_module` FOREIGN KEY (`module_id`) REFERENCES `knowledge_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
