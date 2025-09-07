-- 知识模块标签权限表
-- 用于控制团队模块的细粒度访问权限
CREATE TABLE IF NOT EXISTS knowledge_module_tag_permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  module_id BIGINT NOT NULL COMMENT '知识模块ID',
  tag_id BIGINT NOT NULL COMMENT '用户标签ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT DEFAULT NULL COMMENT '创建者ID',
  
  UNIQUE KEY uk_module_tag (module_id, tag_id),
  INDEX idx_module_id (module_id),
  INDEX idx_tag_id (tag_id),
  INDEX idx_created_by (created_by),
  
  FOREIGN KEY (module_id) REFERENCES knowledge_modules(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知识模块标签权限关系表';

-- 添加注释说明
ALTER TABLE knowledge_module_tag_permissions COMMENT = '知识模块标签权限关系表 - 用于团队模块的访问控制，如果模块没有任何标签限制则表示全组可访问';
