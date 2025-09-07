-- 删除可能存在的错误表
DROP TABLE IF EXISTS user_tag_history;

-- 创建标签操作历史表（匹配users表的ID类型）
CREATE TABLE user_tag_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  action ENUM('add', 'remove') NOT NULL,
  operator_id BIGINT NOT NULL,
  reason VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_history (user_id, created_at),
  INDEX idx_tag_history (tag_id, created_at),
  INDEX idx_operator (operator_id),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签操作历史记录表';
