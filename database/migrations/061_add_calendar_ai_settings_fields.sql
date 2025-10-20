-- 061: 为日历用户设置表添加AI分析配置字段
-- 用途：支持用户自定义AI分析的模板ID、前后扫描天数

ALTER TABLE calendar_user_settings 
  ADD COLUMN template_id BIGINT NULL COMMENT 'AI分析模板ID' AFTER default_model_id,
  ADD COLUMN scan_days_before INT DEFAULT 15 COMMENT '今日前扫描天数' AFTER template_id,
  ADD COLUMN scan_days_after INT DEFAULT 15 COMMENT '今日后扫描天数' AFTER scan_days_before;

-- 说明：保留 default_scan_range 字段作为向后兼容
