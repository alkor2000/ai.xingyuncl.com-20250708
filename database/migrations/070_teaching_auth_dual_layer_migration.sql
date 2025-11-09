-- =====================================================
-- 教学授权系统双层配置迁移脚本
-- 版本：v1.0.0
-- 日期：2025-11-09
-- 功能：将单层配置转换为双层配置，分离超级管理员和组管理员授权
-- =====================================================

-- 开启事务
START TRANSACTION;

-- 1. 创建临时存储过程用于数据转换
DELIMITER $$

DROP PROCEDURE IF EXISTS migrate_teaching_auth_to_dual_layer$$

CREATE PROCEDURE migrate_teaching_auth_to_dual_layer()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_id BIGINT;
    DECLARE v_group_id BIGINT;
    DECLARE v_config_data JSON;
    DECLARE v_created_by BIGINT;
    DECLARE v_updated_by BIGINT;
    DECLARE v_new_config JSON;
    
    -- 声明游标
    DECLARE auth_cursor CURSOR FOR 
        SELECT id, group_id, config_data, created_by, updated_by
        FROM teaching_global_authorizations;
    
    -- 声明继续处理器
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    
    -- 打开游标
    OPEN auth_cursor;
    
    -- 循环处理每条记录
    read_loop: LOOP
        FETCH auth_cursor INTO v_id, v_group_id, v_config_data, v_created_by, v_updated_by;
        
        IF done THEN
            LEAVE read_loop;
        END IF;
        
        -- 检查数据是否已经是双层格式
        IF JSON_EXTRACT(v_config_data, '$.superAdminConfig') IS NOT NULL THEN
            -- 已经是新格式，跳过
            ITERATE read_loop;
        END IF;
        
        -- 构建新的双层配置格式
        SET v_new_config = JSON_OBJECT(
            'superAdminConfig', JSON_OBJECT(
                'modulePermissions', 
                IFNULL(JSON_EXTRACT(v_config_data, '$.modulePermissions'), JSON_ARRAY()),
                'createdBy', v_created_by,
                'createdAt', NOW(),
                'note', '从旧格式迁移的超级管理员配置'
            ),
            'groupAdminConfig', JSON_OBJECT(
                'tags', 
                IFNULL(JSON_EXTRACT(v_config_data, '$.tags'), JSON_ARRAY()),
                'updatedBy', v_updated_by,
                'updatedAt', NOW(),
                'note', '从旧格式迁移的组管理员配置'
            ),
            'version', '2.0.0',
            'migratedAt', NOW()
        );
        
        -- 更新记录
        UPDATE teaching_global_authorizations 
        SET config_data = v_new_config
        WHERE id = v_id;
        
        -- 记录迁移日志
        INSERT INTO migrations_history (migration_name, description, executed_at) 
        VALUES (
            'teaching_auth_dual_layer',
            CONCAT('Migrated auth config for group_id: ', v_group_id),
            NOW()
        );
    END LOOP;
    
    -- 关闭游标
    CLOSE auth_cursor;
    
    SELECT CONCAT('Migration completed. Total records processed: ', 
                  (SELECT COUNT(*) FROM teaching_global_authorizations)) AS result;
END$$

DELIMITER ;

-- 2. 执行迁移存储过程
CALL migrate_teaching_auth_to_dual_layer();

-- 3. 删除临时存储过程
DROP PROCEDURE IF EXISTS migrate_teaching_auth_to_dual_layer;

-- 4. 添加配置格式版本字段（用于未来的迁移）
ALTER TABLE teaching_global_authorizations 
ADD COLUMN IF NOT EXISTS config_version VARCHAR(20) DEFAULT '2.0.0' 
COMMENT '配置格式版本' AFTER config_data;

-- 5. 更新现有记录的版本号
UPDATE teaching_global_authorizations 
SET config_version = '2.0.0' 
WHERE config_version IS NULL;

-- 提交事务
COMMIT;

-- 输出迁移完成信息
SELECT 'Migration to dual-layer authorization completed successfully!' AS status;
