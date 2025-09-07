-- 标签操作历史表
CREATE TABLE IF NOT EXISTS user_tag_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  tag_id INT NOT NULL,
  action ENUM('add', 'remove') NOT NULL,
  operator_id INT NOT NULL,
  reason VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_history (user_id, created_at),
  INDEX idx_tag_history (tag_id, created_at),
  INDEX idx_operator (operator_id),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
