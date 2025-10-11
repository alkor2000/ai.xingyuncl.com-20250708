-- =====================================================
-- 日历背景知识系统
-- 版本: 1.0.0
-- 日期: 2025-10-12
-- 描述: 添加用户可自定义的背景知识，AI分析时拼接到提示词
-- =====================================================

-- 1. 创建日历背景知识表
CREATE TABLE IF NOT EXISTS calendar_background_knowledge (
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

-- 2. 添加字符集和排序规则检查
ALTER TABLE calendar_background_knowledge 
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. 添加内容长度检查约束（通过触发器实现）
DELIMITER //

CREATE TRIGGER before_insert_calendar_background_knowledge
BEFORE INSERT ON calendar_background_knowledge
FOR EACH ROW
BEGIN
  -- 验证标题长度
  IF CHAR_LENGTH(NEW.title) > 100 THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '标题长度不能超过100字符';
  END IF;
  
  -- 验证内容长度
  IF CHAR_LENGTH(NEW.content) > 2000 THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '内容长度不能超过2000字符';
  END IF;
  
  -- 验证标题不能为空
  IF TRIM(NEW.title) = '' THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '标题不能为空';
  END IF;
  
  -- 验证内容不能为空
  IF TRIM(NEW.content) = '' THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '内容不能为空';
  END IF;
END//

CREATE TRIGGER before_update_calendar_background_knowledge
BEFORE UPDATE ON calendar_background_knowledge
FOR EACH ROW
BEGIN
  -- 验证标题长度
  IF CHAR_LENGTH(NEW.title) > 100 THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '标题长度不能超过100字符';
  END IF;
  
  -- 验证内容长度
  IF CHAR_LENGTH(NEW.content) > 2000 THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '内容长度不能超过2000字符';
  END IF;
  
  -- 验证标题不能为空
  IF TRIM(NEW.title) = '' THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '标题不能为空';
  END IF;
  
  -- 验证内容不能为空
  IF TRIM(NEW.content) = '' THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '内容不能为空';
  END IF;
END//

DELIMITER ;

-- 4. 创建示例数据（可选 - 用于测试）
-- INSERT INTO calendar_background_knowledge (user_uuid, title, content, enabled, sort_order) VALUES
-- ('example-uuid-123', '我的职业背景', '我是一名全栈工程师，主要使用 React、Node.js、MySQL 技术栈，目前在开发企业级AI平台项目...', TRUE, 1),
-- ('example-uuid-123', '我的作息规律', '我习惯早上 6:30 起床晨跑，8:00 开始工作，晚上 11:00 睡觉。周末喜欢学习新技术和阅读。', TRUE, 2);

-- 5. 验证表结构
SELECT 
  TABLE_NAME,
  TABLE_COMMENT,
  ENGINE,
  TABLE_COLLATION
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'ai_platform' 
  AND TABLE_NAME = 'calendar_background_knowledge';

-- 6. 验证字段
SELECT 
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = 'ai_platform' 
  AND TABLE_NAME = 'calendar_background_knowledge'
ORDER BY ORDINAL_POSITION;

-- 7. 验证索引
SHOW INDEX FROM calendar_background_knowledge;

SELECT '✅ 日历背景知识表创建完成！' AS result;
