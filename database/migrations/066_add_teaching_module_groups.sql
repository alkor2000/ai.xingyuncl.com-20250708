-- 066: 添加教学模块分组功能（多对多关系）
-- 创建时间: 2025-10-25
-- 说明: 支持一个模块属于多个分组

-- =====================================================
-- 表1: 教学模块分组表
-- =====================================================
CREATE TABLE IF NOT EXISTS teaching_module_groups (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分组名称（如：小学1年级数学课程包）',
  description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '分组描述',
  
  -- 排序和状态
  sort_order INT DEFAULT 0 COMMENT '排序序号（数字越小越靠前）',
  is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  
  -- 权限控制（预留，后续支持）
  visibility ENUM('public', 'group', 'private') DEFAULT 'public' COMMENT '可见性（预留）',
  owner_group_id BIGINT DEFAULT NULL COMMENT '所属组织ID（预留）',
  
  -- 创建者
  created_by BIGINT NOT NULL COMMENT '创建者用户ID',
  
  -- 时间戳
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_sort_order (sort_order),
  KEY idx_is_active (is_active),
  KEY idx_created_by (created_by),
  KEY idx_owner_group_id (owner_group_id),
  
  CONSTRAINT fk_teaching_groups_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_teaching_groups_owner FOREIGN KEY (owner_group_id) REFERENCES user_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块分组表';

-- =====================================================
-- 表2: 教学模块-分组关系表（多对多）
-- =====================================================
CREATE TABLE IF NOT EXISTS teaching_module_group_relations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  module_id BIGINT NOT NULL COMMENT '教学模块ID',
  group_id BIGINT NOT NULL COMMENT '分组ID',
  
  -- 排序
  sort_order INT DEFAULT 0 COMMENT '模块在分组内的排序序号',
  
  -- 时间戳
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY uk_module_group (module_id, group_id),
  KEY idx_module_id (module_id),
  KEY idx_group_id (group_id),
  KEY idx_group_sort (group_id, sort_order),
  
  CONSTRAINT fk_module_group_module FOREIGN KEY (module_id) REFERENCES teaching_modules(id) ON DELETE CASCADE,
  CONSTRAINT fk_module_group_group FOREIGN KEY (group_id) REFERENCES teaching_module_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='教学模块分组关系表';

-- =====================================================
-- 记录迁移历史
-- =====================================================
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('066_add_teaching_module_groups', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();

-- =====================================================
-- 执行完成提示
-- =====================================================
SELECT '✅ 教学模块分组表创建完成！' AS status;
