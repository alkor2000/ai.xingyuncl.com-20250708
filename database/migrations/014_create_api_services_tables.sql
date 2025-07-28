-- API服务配置表
CREATE TABLE IF NOT EXISTS api_services (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  service_id VARCHAR(100) NOT NULL UNIQUE COMMENT '服务唯一标识',
  service_name VARCHAR(255) NOT NULL COMMENT '服务显示名称', 
  api_key VARCHAR(255) NOT NULL COMMENT 'API密钥',
  description TEXT COMMENT '服务描述',
  status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_service_id (service_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API服务配置表';

-- API服务操作配置表
CREATE TABLE IF NOT EXISTS api_service_actions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  service_id VARCHAR(100) NOT NULL COMMENT '关联的服务ID',
  action_type VARCHAR(100) NOT NULL COMMENT '操作类型',
  action_name VARCHAR(255) NOT NULL COMMENT '操作显示名称',
  credits INT NOT NULL DEFAULT 1 COMMENT '消耗积分数',
  description TEXT COMMENT '操作说明',
  status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_service_action (service_id, action_type),
  INDEX idx_service_id (service_id),
  INDEX idx_status (status),
  FOREIGN KEY (service_id) REFERENCES api_services(service_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API服务操作配置表';

-- 插入默认的图像生成服务配置（示例）
INSERT INTO api_services (service_id, service_name, api_key, description) VALUES 
('image_gen', '图像生成服务', CONCAT('sk-', MD5(CONCAT('image_gen', NOW()))), '提供AI图像生成功能');

INSERT INTO api_service_actions (service_id, action_type, action_name, credits, description) VALUES
('image_gen', 'generate_image', '生成图片', 5, '生成一张AI图片');
