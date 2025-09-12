-- 添加文件夹类型支持（全局、组织、个人）
-- 执行时间：2024-09-12

-- 1. 为user_folders表添加folder_type和group_id字段
ALTER TABLE user_folders 
ADD COLUMN folder_type ENUM('personal', 'global', 'group') DEFAULT 'personal' COMMENT '文件夹类型' AFTER parent_id,
ADD COLUMN group_id BIGINT DEFAULT NULL COMMENT '组织ID（仅组织文件夹）' AFTER folder_type,
ADD INDEX idx_folder_type (folder_type),
ADD INDEX idx_group_id (group_id),
ADD CONSTRAINT fk_user_folders_group FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE;

-- 2. 为user_files表添加uploaded_by字段
ALTER TABLE user_files
ADD COLUMN uploaded_by BIGINT DEFAULT NULL COMMENT '上传者ID' AFTER user_id,
ADD INDEX idx_uploaded_by (uploaded_by),
ADD CONSTRAINT fk_user_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

-- 3. 更新现有数据
UPDATE user_folders SET folder_type = 'personal' WHERE folder_type IS NULL;
UPDATE user_files SET uploaded_by = user_id WHERE uploaded_by IS NULL;

-- 4. 创建全局文件夹（使用超级管理员账号）
INSERT INTO user_folders (user_id, folder_type, name, path, created_at)
SELECT 
    (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1) as user_id,
    'global' as folder_type,
    '全局共享' as name,
    '/全局共享' as path,
    NOW() as created_at
WHERE EXISTS (SELECT 1 FROM users WHERE role = 'super_admin')
AND NOT EXISTS (SELECT 1 FROM user_folders WHERE folder_type = 'global' AND name = '全局共享');

-- 5. 为有管理员的组创建组织文件夹
INSERT INTO user_folders (user_id, folder_type, group_id, name, path, created_at)
SELECT 
    COALESCE(
        (SELECT id FROM users WHERE role = 'admin' AND group_id = g.id LIMIT 1),
        (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1)
    ) as user_id,
    'group' as folder_type,
    g.id as group_id,
    CONCAT(g.name, '共享') as name,
    CONCAT('/', g.name, '共享') as path,
    NOW() as created_at
FROM user_groups g
WHERE g.is_active = 1
AND EXISTS (
    SELECT 1 FROM users 
    WHERE (role = 'admin' AND group_id = g.id) 
    OR role = 'super_admin'
)
AND NOT EXISTS (
    SELECT 1 FROM user_folders f 
    WHERE f.folder_type = 'group' 
    AND f.group_id = g.id
);

-- 6. 记录迁移
INSERT INTO migration_history (migration_name, executed_at) 
VALUES ('046_add_folder_types.sql', NOW());
