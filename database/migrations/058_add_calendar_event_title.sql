-- =====================================================
-- 日历事项添加标题字段
-- 版本: 1.0.0
-- 日期: 2025-10-13
-- 描述: 为calendar_events表添加可选的title字段
-- =====================================================

-- 添加title字段（可选，最多100字符）
ALTER TABLE calendar_events 
ADD COLUMN title VARCHAR(100) DEFAULT NULL COMMENT '事项标题（可选，显示用）' 
AFTER user_id;

-- 为已有数据生成默认标题（截取content前20字）
UPDATE calendar_events 
SET title = SUBSTRING(content, 1, 20)
WHERE title IS NULL AND content IS NOT NULL;

-- 添加索引优化查询
CREATE INDEX idx_title ON calendar_events(title);

-- 迁移完成标记
SELECT '✅ 日历事项标题字段添加完成' AS status, NOW() AS completed_at;
