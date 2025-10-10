-- =====================================================
-- 智能日历性能优化 - 索引优化
-- 版本: 1.0.0
-- 日期: 2025-10-10
-- 描述: 添加复合索引，优化查询性能
-- =====================================================

-- 1. 优化事项查询的复合索引
-- 用于getUserEvents的日期范围查询
ALTER TABLE calendar_events 
ADD INDEX idx_user_date_status (user_id, event_date, status),
ADD INDEX idx_user_importance (user_id, importance DESC),
ADD INDEX idx_date_importance (event_date, importance DESC);

-- 2. 优化月度统计查询
-- 用于getMonthStats的年月查询
ALTER TABLE calendar_events
ADD INDEX idx_user_year_month (user_id, event_date, status, importance);

-- 3. 优化分类统计
ALTER TABLE calendar_events
ADD INDEX idx_user_category_date (user_id, category, event_date);

-- 4. 优化AI分析查询
ALTER TABLE calendar_ai_analyses
ADD INDEX idx_user_created (user_id, created_at DESC),
ADD INDEX idx_model_date (model_id, created_at DESC);

-- 5. 优化分类查询
ALTER TABLE calendar_categories
ADD INDEX idx_user_active_sort (user_id, is_active, sort_order);

-- 6. 分析现有索引使用情况
SELECT 
    TABLE_NAME,
    INDEX_NAME,
    SEQ_IN_INDEX,
    COLUMN_NAME,
    CARDINALITY
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'ai_platform'
  AND TABLE_NAME LIKE 'calendar_%'
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

-- 7. 显示表大小和行数
SELECT 
    TABLE_NAME as '表名',
    TABLE_ROWS as '行数',
    ROUND(DATA_LENGTH / 1024 / 1024, 2) as '数据大小(MB)',
    ROUND(INDEX_LENGTH / 1024 / 1024, 2) as '索引大小(MB)',
    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) as '总大小(MB)'
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'ai_platform'
  AND TABLE_NAME LIKE 'calendar_%'
ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC;

SELECT '✅ 日历索引优化完成！查询性能已提升' AS result;
