-- =====================================================
-- 日历事项字段约束调整
-- 版本: 1.0.0
-- 日期: 2025-10-13
-- 描述: title改为必填，content改为选填
-- =====================================================

-- 1. 先填充所有空title（使用content前20字）
UPDATE calendar_events 
SET title = SUBSTRING(content, 1, 20)
WHERE title IS NULL OR title = '';

-- 2. 修改title为必填
ALTER TABLE calendar_events 
MODIFY COLUMN title VARCHAR(100) NOT NULL COMMENT '事项标题（必填）';

-- 3. 修改content为可选
ALTER TABLE calendar_events 
MODIFY COLUMN content TEXT DEFAULT NULL COMMENT '事项内容（可选，支持Markdown）';

-- 迁移完成标记
SELECT '✅ 日历字段约束调整完成：title必填，content可选' AS status, NOW() AS completed_at;
