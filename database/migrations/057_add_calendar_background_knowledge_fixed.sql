-- =====================================================
-- 日历背景知识系统（修复版 - 无触发器）
-- 版本: 1.0.1
-- 日期: 2025-10-12
-- 描述: 添加用户可自定义的背景知识，长度验证在应用层实现
-- =====================================================

-- 1. 删除可能存在的旧表和触发器
DROP TABLE IF EXISTS calendar_background_knowledge;
DROP TRIGGER IF EXISTS before_insert_calendar_background_knowledge;
DROP TRIGGER IF EXISTS before_update_calendar_background_knowledge;

-- 2. 创建日历背景知识表
CREATE TABLE calendar_background_knowledge (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  user_uuid VARCHAR(36) NOT NULL COMMENT '用户UUID（支持SSO）',
  title VARCHAR(100) NOT NULL COMMENT '标题（最多100字符）',
  content TEXT NOT NULL COMMENT '内容（最多2000字符）',
  enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用（支持多选）',
  sort_order INT DEFAULT 0 COMMENT '排序（数字越小越靠前）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引优化
  INDEX idx_user_uuid (user_uuid) COMMENT '用户UUID索引',
  INDEX idx_enabled (enabled) COMMENT '启用状态索引',
  INDEX idx_sort_order (sort_order) COMMENT '排序索引',
  INDEX idx_user_enabled_order (user_uuid, enabled, sort_order) COMMENT '复合查询索引'
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='日历背景知识表 - 用户个人信息、职业背景、生活习惯等';

-- 3. 验证表创建
SELECT '✅ 表创建成功' AS status;

-- 4. 显示表结构
DESC calendar_background_knowledge;

-- 5. 显示索引
SHOW INDEX FROM calendar_background_knowledge;
