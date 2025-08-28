-- 简化存储积分配置表
DROP TABLE IF EXISTS storage_credits_config_simple;

CREATE TABLE storage_credits_config_simple (
  id BIGINT NOT NULL AUTO_INCREMENT,
  base_credits INT DEFAULT 2 COMMENT '基础积分（每次上传最少扣除）',
  credits_per_5mb DECIMAL(10,2) DEFAULT 1.00 COMMENT '每5MB额外扣除积分',
  max_file_size INT DEFAULT 100 COMMENT '最大文件大小（MB）',
  is_active TINYINT(1) DEFAULT 1,
  updated_by BIGINT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简化的存储积分配置';

-- 插入默认配置
INSERT INTO storage_credits_config_simple (base_credits, credits_per_5mb, max_file_size) 
VALUES (2, 1.00, 100);
