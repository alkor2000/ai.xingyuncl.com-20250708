-- ====================================================================
-- AI Agent 工作流系统数据库迁移（幂等版本）
-- 版本: 1.0.1
-- 创建日期: 2025-01-15
-- 描述: 创建AI Agent拖拽式工作流系统的完整数据库结构
-- ====================================================================

-- ====================================================================
-- 1. 工作流主表
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_workflows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工作流ID',
  user_id BIGINT NOT NULL COMMENT '创建用户ID',
  name VARCHAR(255) NOT NULL COMMENT '工作流名称',
  description TEXT COMMENT '工作流描述',
  flow_data JSON NOT NULL COMMENT '节点和连线的JSON数据（包含nodes和edges）',
  is_published BOOLEAN DEFAULT FALSE COMMENT '是否发布（发布后用户可执行）',
  version INT DEFAULT 1 COMMENT '版本号',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  INDEX idx_user_id (user_id),
  INDEX idx_published (is_published),
  INDEX idx_created_at (created_at),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI工作流主表';

-- ====================================================================
-- 2. 节点类型配置表（超级管理员管理）
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_node_types (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '节点类型ID',
  type_key VARCHAR(50) NOT NULL UNIQUE COMMENT '节点类型唯一标识（如：start, llm, knowledge）',
  name VARCHAR(100) NOT NULL COMMENT '节点显示名称',
  category ENUM('input', 'process', 'output', 'control') DEFAULT 'process' COMMENT '节点分类：输入/处理/输出/控制',
  icon VARCHAR(50) DEFAULT 'NodeIndexOutlined' COMMENT 'Ant Design图标名称',
  color VARCHAR(20) DEFAULT '#1890ff' COMMENT '节点主题颜色（HEX）',
  description TEXT COMMENT '节点功能描述',
  config_schema JSON COMMENT '节点配置字段的JSON Schema定义',
  credits_per_execution INT DEFAULT 0 COMMENT '每次执行消耗的积分',
  max_inputs INT DEFAULT 1 COMMENT '最大输入连接数（0表示不能有输入）',
  max_outputs INT DEFAULT 1 COMMENT '最大输出连接数（0表示不能有输出）',
  is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
  display_order INT DEFAULT 0 COMMENT '显示顺序（数字越小越靠前）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  INDEX idx_category (category),
  INDEX idx_active (is_active),
  INDEX idx_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent节点类型配置表';

-- ====================================================================
-- 3. 执行记录表
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_executions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '执行记录ID',
  workflow_id BIGINT NOT NULL COMMENT '工作流ID',
  user_id BIGINT NOT NULL COMMENT '执行用户ID',
  input_data JSON COMMENT '输入参数',
  output_data JSON COMMENT '输出结果',
  execution_log JSON COMMENT '执行日志（包含每个节点的详细信息）',
  status ENUM('running', 'success', 'failed', 'cancelled') DEFAULT 'running' COMMENT '执行状态',
  total_credits_used INT DEFAULT 0 COMMENT '消耗的总积分',
  error_message TEXT COMMENT '错误信息（失败时记录）',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  completed_at TIMESTAMP NULL COMMENT '完成时间',
  duration_ms INT COMMENT '执行时长（毫秒）',
  
  INDEX idx_workflow_id (workflow_id),
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_started_at (started_at),
  
  FOREIGN KEY (workflow_id) REFERENCES agent_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent执行记录表';

-- ====================================================================
-- 4. 节点执行日志表（详细追踪每个节点）
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_node_executions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '节点执行日志ID',
  execution_id BIGINT NOT NULL COMMENT '所属执行记录ID',
  node_id VARCHAR(50) NOT NULL COMMENT '节点ID（前端生成的唯一标识）',
  node_type VARCHAR(50) NOT NULL COMMENT '节点类型（如：llm, knowledge）',
  node_name VARCHAR(255) COMMENT '节点名称（用户自定义）',
  input_data JSON COMMENT '节点输入数据',
  output_data JSON COMMENT '节点输出数据',
  credits_used INT DEFAULT 0 COMMENT '节点消耗的积分',
  status ENUM('pending', 'running', 'success', 'failed') DEFAULT 'pending' COMMENT '节点执行状态',
  error_message TEXT COMMENT '节点错误信息',
  started_at TIMESTAMP NULL COMMENT '开始时间',
  completed_at TIMESTAMP NULL COMMENT '完成时间',
  duration_ms INT COMMENT '执行时长（毫秒）',
  
  INDEX idx_execution_id (execution_id),
  INDEX idx_node_type (node_type),
  INDEX idx_status (status),
  
  FOREIGN KEY (execution_id) REFERENCES agent_executions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='节点执行日志表';

-- ====================================================================
-- 5. 工作流模板表（预设模板，可选功能）
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_workflow_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '模板ID',
  name VARCHAR(255) NOT NULL COMMENT '模板名称',
  description TEXT COMMENT '模板描述',
  category VARCHAR(50) COMMENT '模板分类（如：数据分析、内容生成）',
  template_data JSON NOT NULL COMMENT '模板的flow_data（节点和连线）',
  preview_image VARCHAR(500) COMMENT '预览图URL',
  is_system BOOLEAN DEFAULT FALSE COMMENT '是否系统内置模板',
  created_by BIGINT COMMENT '创建者用户ID',
  usage_count INT DEFAULT 0 COMMENT '被使用次数',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  INDEX idx_category (category),
  INDEX idx_system (is_system),
  INDEX idx_usage_count (usage_count),
  
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流模板表';

-- ====================================================================
-- 6. 修改积分交易类型ENUM，添加agent_execution
-- ====================================================================
ALTER TABLE credit_transactions 
MODIFY COLUMN transaction_type ENUM(
  'admin_add','admin_deduct','admin_set',
  'chat_consume','image_consume','video_consume',
  'system_reward','group_distribute','group_recycle',
  'api_consume','html_create','html_update','html_publish',
  'storage_upload','mindmap_save','mindmap_export',
  'ocr_consume','calendar_analysis','agent_execution'
) DEFAULT 'chat_consume';

-- ====================================================================
-- 7. 插入默认节点类型（使用INSERT IGNORE避免重复）
-- ====================================================================

-- 开始节点
INSERT IGNORE INTO agent_node_types (
  type_key, name, category, icon, color, description, 
  credits_per_execution, max_inputs, max_outputs, config_schema, display_order
) VALUES (
  'start',
  '开始',
  'input',
  'PlayCircleOutlined',
  '#52c41a',
  '工作流的起始节点，定义输入参数',
  0,
  0,
  1,
  '{}',
  1
);

-- AI对话节点
INSERT IGNORE INTO agent_node_types (
  type_key, name, category, icon, color, description, 
  credits_per_execution, max_inputs, max_outputs, config_schema, display_order
) VALUES (
  'llm',
  'AI对话',
  'process',
  'RobotOutlined',
  '#1890ff',
  '调用大语言模型进行对话和推理',
  10,
  1,
  1,
  JSON_OBJECT(
    'model_id', JSON_OBJECT(
      'type', 'select',
      'label', 'AI模型',
      'required', true,
      'description', '选择要使用的AI模型'
    ),
    'system_prompt', JSON_OBJECT(
      'type', 'textarea',
      'label', '系统提示词',
      'required', false,
      'placeholder', '你是一个专业的AI助手...'
    ),
    'user_prompt', JSON_OBJECT(
      'type', 'textarea',
      'label', '用户提示词',
      'required', true,
      'placeholder', '请输入要发送给AI的内容，可使用{{变量名}}引用其他节点的输出'
    ),
    'temperature', JSON_OBJECT(
      'type', 'number',
      'label', '温度',
      'default', 0.7,
      'min', 0,
      'max', 2,
      'step', 0.1,
      'description', '控制输出的随机性，越高越随机'
    ),
    'max_tokens', JSON_OBJECT(
      'type', 'number',
      'label', '最大Token数',
      'default', 2000,
      'min', 100,
      'max', 4000,
      'description', '限制AI响应的最大长度'
    )
  ),
  2
);

-- 知识库检索节点
INSERT IGNORE INTO agent_node_types (
  type_key, name, category, icon, color, description, 
  credits_per_execution, max_inputs, max_outputs, config_schema, display_order
) VALUES (
  'knowledge',
  '知识库检索',
  'process',
  'DatabaseOutlined',
  '#722ed1',
  '从知识模块中检索相关信息',
  5,
  1,
  1,
  JSON_OBJECT(
    'module_ids', JSON_OBJECT(
      'type', 'multi-select',
      'label', '知识模块',
      'required', true,
      'description', '选择要检索的知识模块（可多选）'
    ),
    'query', JSON_OBJECT(
      'type', 'textarea',
      'label', '检索查询',
      'required', true,
      'placeholder', '请输入要检索的内容，可使用{{变量名}}引用'
    ),
    'top_k', JSON_OBJECT(
      'type', 'number',
      'label', '返回结果数量',
      'default', 5,
      'min', 1,
      'max', 20,
      'description', '返回最相关的K个结果'
    ),
    'similarity_threshold', JSON_OBJECT(
      'type', 'number',
      'label', '相似度阈值',
      'default', 0.7,
      'min', 0,
      'max', 1,
      'step', 0.05,
      'description', '只返回相似度高于此阈值的结果'
    )
  ),
  3
);

-- 结束节点
INSERT IGNORE INTO agent_node_types (
  type_key, name, category, icon, color, description, 
  credits_per_execution, max_inputs, max_outputs, config_schema, display_order
) VALUES (
  'end',
  '结束',
  'output',
  'CheckCircleOutlined',
  '#ff4d4f',
  '工作流的结束节点，输出最终结果',
  0,
  1,
  0,
  JSON_OBJECT(
    'output_format', JSON_OBJECT(
      'type', 'select',
      'label', '输出格式',
      'default', 'text',
      'options', JSON_ARRAY(
        JSON_OBJECT('value', 'text', 'label', '纯文本'),
        JSON_OBJECT('value', 'json', 'label', 'JSON格式'),
        JSON_OBJECT('value', 'markdown', 'label', 'Markdown')
      )
    )
  ),
  4
);

-- ====================================================================
-- 8. 添加系统模块注册（Agent模块）
-- ====================================================================
INSERT INTO system_modules (
  name, display_name, description, module_type, module_category,
  route_path, open_mode, menu_icon, is_active, can_disable, sort_order, proxy_path
) VALUES (
  'agent',
  'AI工作流',
  'AI Agent拖拽式工作流编排系统',
  'fullstack',
  'system',
  '/agent',
  'iframe',
  'ApartmentOutlined',
  1,
  1,
  50,
  '/agent'
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;

-- ====================================================================
-- 完成标记
-- ====================================================================
SELECT '✅ AI Agent工作流系统数据库迁移完成！' as Status;
SELECT CONCAT('- 创建了 ', COUNT(*), ' 个节点类型') as NodeTypes FROM agent_node_types;
SELECT '- 工作流表、执行记录表、节点日志表已就绪' as Tables;
