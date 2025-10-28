-- 添加课程资料功能
-- 支持每个课程最多5个资料链接

-- 1. 添加materials字段到teaching_lessons表
ALTER TABLE teaching_lessons 
ADD COLUMN materials JSON DEFAULT NULL COMMENT '课程资料，最多5个链接' 
AFTER cover_image;

-- 2. 添加索引优化查询
ALTER TABLE teaching_lessons 
ADD INDEX idx_has_materials ((CASE WHEN materials IS NOT NULL THEN 1 ELSE 0 END));

-- 3. 更新现有记录，设置默认值为空数组
UPDATE teaching_lessons 
SET materials = JSON_ARRAY() 
WHERE materials IS NULL;

-- 记录迁移信息
INSERT INTO migrations_history (migration_name, executed_at) 
VALUES ('068_add_lesson_materials.sql', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
