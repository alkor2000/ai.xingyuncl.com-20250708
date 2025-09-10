-- 综合迁移脚本 041-045: 用户标签系统
-- 执行时间: 2025-09-11
-- 包含: 用户标签、标签关系、操作历史、知识模块权限

-- 1. 创建用户标签定义表
CREATE TABLE IF NOT EXISTS user_tags (
  id BIGINT NOT NULL AUTO_INCREMENT,
  group_id BIGINT NOT NULL COMMENT '所属用户组ID',
  name VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签名称',
  color VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '#1677ff' COMMENT '标签颜色',
  description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '标签描述',
  icon VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '图标名称',
  sort_order INT DEFAULT 0 COMMENT '排序顺序',
  is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  created_by BIGINT DEFAULT NULL COMMENT '创建者用户ID',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_group_tag_name (group_id, name),
  KEY idx_group_id (group_id),
  KEY idx_is_active (is_active),
  KEY idx_sort_order (sort_order),
  KEY idx_created_by (created_by),
  KEY idx_group_active (group_id, is_active),
  CONSTRAINT fk_user_tags_group FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_tags_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户标签定义表';

-- 2. 创建用户标签关系表
CREATE TABLE IF NOT EXISTS user_tag_relations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT '用户ID',
  tag_id BIGINT NOT NULL COMMENT '标签ID',
  assigned_by BIGINT DEFAULT NULL COMMENT '分配者用户ID',
  assigned_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '分配时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_tag (user_id, tag_id),
  KEY idx_user_id (user_id),
  KEY idx_tag_id (tag_id),
  KEY idx_assigned_by (assigned_by),
  KEY idx_assigned_at (assigned_at),
  KEY idx_user_tag (user_id, tag_id),
  KEY idx_tag_user (tag_id, user_id),
  CONSTRAINT fk_tag_relations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tag_relations_tag FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE,
  CONSTRAINT fk_tag_relations_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户标签关系表';

-- 3. 创建标签操作历史表
CREATE TABLE IF NOT EXISTS user_tag_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  action ENUM('add', 'remove') NOT NULL,
  operator_id BIGINT NOT NULL,
  reason VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_history (user_id, created_at),
  INDEX idx_tag_history (tag_id, created_at),
  INDEX idx_operator (operator_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签操作历史记录表';

-- 4. 创建知识模块标签权限表
CREATE TABLE IF NOT EXISTS knowledge_module_tag_permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  module_id BIGINT NOT NULL COMMENT '知识模块ID',
  tag_id BIGINT NOT NULL COMMENT '用户标签ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT DEFAULT NULL COMMENT '创建者ID',
  UNIQUE KEY uk_module_tag (module_id, tag_id),
  INDEX idx_module_id (module_id),
  INDEX idx_tag_id (tag_id),
  INDEX idx_created_by (created_by),
  INDEX idx_module_tag_combined (module_id, tag_id),
  INDEX idx_created_by_date (created_by, created_at),
  FOREIGN KEY (module_id) REFERENCES knowledge_modules(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识模块标签权限关系表 - 用于团队模块的访问控制';

-- 5. 为users表添加tag_count字段
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'tag_count';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname
   AND TABLE_NAME = @tablename
   AND COLUMN_NAME = @columnname) > 0,
  'SELECT "字段tag_count已存在" AS message;',
  'ALTER TABLE users ADD COLUMN tag_count INT DEFAULT 0 COMMENT "用户标签数量" AFTER group_id, ADD INDEX idx_tag_count (tag_count);'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 6. 创建用户标签详情视图
CREATE OR REPLACE VIEW v_user_tags_detail AS
SELECT 
  utr.id AS relation_id,
  utr.user_id,
  u.username,
  u.email,
  u.group_id AS user_group_id,
  ut.id AS tag_id,
  ut.name AS tag_name,
  ut.color AS tag_color,
  ut.description AS tag_description,
  ut.icon AS tag_icon,
  ut.group_id AS tag_group_id,
  ug.name AS group_name,
  utr.assigned_at,
  utr.assigned_by,
  assigner.username AS assigned_by_username
FROM user_tag_relations utr
JOIN users u ON utr.user_id = u.id
JOIN user_tags ut ON utr.tag_id = ut.id
JOIN user_groups ug ON ut.group_id = ug.id
LEFT JOIN users assigner ON utr.assigned_by = assigner.id
WHERE ut.is_active = 1;

-- 7. 添加知识模块表索引优化
ALTER TABLE knowledge_modules 
ADD INDEX IF NOT EXISTS idx_scope_group_active (module_scope, group_id, is_active);

-- 记录迁移历史
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('041_045_user_tags_system', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
