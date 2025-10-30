/**
 * 069_add_three_level_teaching_permissions.sql
 * 教学权限三级体系升级（语法修正版）
 * 
 * 升级内容：
 * - view → view_lesson（查看课程）
 * - 新增 view_plan（查看教案）
 * - 保留 edit（编辑）
 * 
 * 权限层级：view_lesson < view_plan < edit
 * 
 * 创建时间: 2025-10-31
 */

-- =====================================================
-- 第1步：备份现有权限数据到临时表
-- =====================================================
DROP TABLE IF EXISTS teaching_permissions_backup_20251031;

CREATE TABLE teaching_permissions_backup_20251031 AS 
SELECT * FROM teaching_permissions;

SELECT CONCAT('✅ 已备份 ', COUNT(*), ' 条权限记录') AS backup_status
FROM teaching_permissions_backup_20251031;

-- =====================================================
-- 第2步：修改permission_type枚举类型
-- =====================================================
-- MySQL修改ENUM的标准方式：先添加新值，再迁移数据，最后删除旧值

-- 2.1 先添加新的枚举值
ALTER TABLE teaching_permissions 
MODIFY COLUMN permission_type ENUM('edit', 'view', 'view_lesson', 'view_plan') 
NOT NULL DEFAULT 'view_lesson' 
COMMENT '权限类型：view_lesson-查看课程，view_plan-查看教案，edit-编辑';

SELECT '✅ 已添加新权限类型枚举值' AS step_status;

-- 2.2 数据迁移：将所有 'view' 改为 'view_lesson'
UPDATE teaching_permissions 
SET permission_type = 'view_lesson' 
WHERE permission_type = 'view';

SELECT CONCAT('✅ 已迁移 ', ROW_COUNT(), ' 条 view 权限为 view_lesson') AS migration_status;

-- 2.3 删除旧的 'view' 枚举值
ALTER TABLE teaching_permissions 
MODIFY COLUMN permission_type ENUM('edit', 'view_lesson', 'view_plan') 
NOT NULL DEFAULT 'view_lesson' 
COMMENT '权限类型：view_lesson-查看课程，view_plan-查看教案，edit-编辑';

SELECT '✅ 已移除旧的 view 枚举值' AS cleanup_status;

-- =====================================================
-- 第3步：更新唯一约束（修正版 - 分步删除）
-- =====================================================
-- 注意：MySQL的ALTER TABLE不支持 DROP INDEX IF EXISTS
-- 需要先检查索引是否存在，然后删除

-- 创建存储过程来安全删除索引
DELIMITER $$

DROP PROCEDURE IF EXISTS drop_index_if_exists$$
CREATE PROCEDURE drop_index_if_exists(
    IN tableName VARCHAR(128),
    IN indexName VARCHAR(128)
)
BEGIN
    DECLARE indexExists INT DEFAULT 0;
    
    SELECT COUNT(1) INTO indexExists
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
        AND table_name = tableName
        AND index_name = indexName;
    
    IF indexExists > 0 THEN
        SET @dropStmt = CONCAT('ALTER TABLE `', tableName, '` DROP INDEX `', indexName, '`');
        PREPARE stmt FROM @dropStmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DELIMITER ;

-- 删除旧的唯一约束
CALL drop_index_if_exists('teaching_permissions', 'uk_module_lesson_user_type');
CALL drop_index_if_exists('teaching_permissions', 'uk_module_lesson_group_type');
CALL drop_index_if_exists('teaching_permissions', 'uk_module_lesson_tag_type');

-- 删除存储过程
DROP PROCEDURE IF EXISTS drop_index_if_exists;

SELECT '✅ 已删除旧的唯一约束' AS index_drop_status;

-- 重建唯一约束（包含新的权限类型）
ALTER TABLE teaching_permissions
ADD UNIQUE KEY uk_module_lesson_user_type (module_id, lesson_id, user_id, permission_type),
ADD UNIQUE KEY uk_module_lesson_group_type (module_id, lesson_id, group_id, permission_type),
ADD UNIQUE KEY uk_module_lesson_tag_type (module_id, lesson_id, tag_id, permission_type);

SELECT '✅ 已重建唯一约束' AS constraint_status;

-- =====================================================
-- 第4步：创建权限级联检查视图（辅助前端验证）
-- =====================================================
CREATE OR REPLACE VIEW v_teaching_permission_hierarchy AS
SELECT 
  tp.id,
  tp.module_id,
  tp.lesson_id,
  tp.user_id,
  tp.group_id,
  tp.tag_id,
  tp.permission_type,
  CASE 
    WHEN tp.permission_type = 'edit' THEN 3
    WHEN tp.permission_type = 'view_plan' THEN 2
    WHEN tp.permission_type = 'view_lesson' THEN 1
  END AS permission_level,
  tp.granted_by,
  tp.granted_at,
  tp.expires_at
FROM teaching_permissions tp
WHERE (tp.expires_at IS NULL OR tp.expires_at > NOW());

SELECT '✅ 已创建权限层级视图' AS view_status;

-- =====================================================
-- 第5步：数据完整性验证
-- =====================================================
-- 验证所有权限类型都是有效值
SELECT 
  '权限类型分布' AS title,
  permission_type,
  COUNT(*) as count
FROM teaching_permissions
GROUP BY permission_type
ORDER BY 
  CASE permission_type
    WHEN 'view_lesson' THEN 1
    WHEN 'view_plan' THEN 2
    WHEN 'edit' THEN 3
  END;

-- 验证权限记录完整性
SELECT 
  '权限统计' AS title,
  CONCAT('总权限数: ', COUNT(*)) as total_permissions,
  CONCAT('模块级: ', SUM(CASE WHEN lesson_id IS NULL THEN 1 ELSE 0 END)) as module_level,
  CONCAT('课程级: ', SUM(CASE WHEN lesson_id IS NOT NULL THEN 1 ELSE 0 END)) as lesson_level
FROM teaching_permissions;

-- =====================================================
-- 第6步：记录迁移历史
-- =====================================================
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('069_add_three_level_teaching_permissions', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();

-- =====================================================
-- 执行完成提示
-- =====================================================
SELECT '======================================' AS '';
SELECT '✅ 三级权限系统升级完成！' AS status;
SELECT '======================================' AS '';
SELECT '' AS '';
SELECT '权限层级说明：' AS '';
SELECT '  Level 1: view_lesson  - 查看课程内容（学生）' AS '';
SELECT '  Level 2: view_plan    - 查看课程+教案（教师）' AS '';
SELECT '  Level 3: edit         - 查看课程+教案+编辑（创建者/管理员）' AS '';
SELECT '' AS '';
SELECT '⚠️  备份表保留位置: teaching_permissions_backup_20251031' AS '';
SELECT '⚠️  如需回滚，请联系技术人员' AS '';
