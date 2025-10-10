-- =====================================================
-- 日历配置系统 - 积分倍数和提示词模板
-- 版本: 1.0.1
-- 日期: 2025-10-12
-- 描述: 添加日历AI分析的配置表和模板表（简化版）
-- =====================================================

-- 1. 日历配置表（单例配置）
CREATE TABLE IF NOT EXISTS calendar_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  credits_multiplier DECIMAL(3,1) DEFAULT 1.0 COMMENT '积分倍数（1.0-10.0）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_multiplier_range CHECK (credits_multiplier >= 1.0 AND credits_multiplier <= 10.0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历配置表';

-- 2. 日历提示词模板表
CREATE TABLE IF NOT EXISTS calendar_prompt_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL COMMENT '模板名称',
  prompt TEXT NOT NULL COMMENT '提示词内容（支持变量替换）',
  description VARCHAR(500) DEFAULT NULL COMMENT '模板描述',
  is_default BOOLEAN DEFAULT FALSE COMMENT '是否默认模板',
  display_order INT DEFAULT 0 COMMENT '显示顺序',
  is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active_order (is_active, display_order),
  INDEX idx_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历提示词模板表';

-- 3. 插入默认配置
INSERT INTO calendar_config (credits_multiplier) VALUES (1.0);

-- 4. 插入默认模板（简化版）
INSERT INTO calendar_prompt_templates (name, prompt, description, is_default, display_order, is_active) VALUES
('综合分析', 
'你是时间管理专家，请分析{scanDateStart}到{scanDateEnd}的{eventsCount}个日历事项，给出优先级排序、时间分配建议、冲突检测和效率优化方案。',
'全面分析时间管理',
TRUE, 1, TRUE),

('时间管理',
'请分析{scanDateStart}到{scanDateEnd}的时间分配情况，评估工作、学习、生活的占比是否合理，提供优化建议。',
'专注时间分配',
FALSE, 2, TRUE),

('任务优先级',
'请对{scanDateStart}到{scanDateEnd}的任务按重要度排序，识别高优任务和紧急任务，给出处理建议。',
'专注优先级排序',
FALSE, 3, TRUE);

SELECT '✅ 日历配置系统创建完成' AS result;
