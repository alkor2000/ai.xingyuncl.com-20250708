-- AI Platform 数据库表结构初始化
-- 创建时间: 2025-01-11
-- 更新时间: 2025-01-12 (新增流式输出支持)

-- 删除已存在的表（开发环境重置用）
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS ai_models;
DROP TABLE IF EXISTS users;

-- 1. 用户表
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL COMMENT '用户邮箱',
    username VARCHAR(100) UNIQUE NOT NULL COMMENT '用户名',
    password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
    role ENUM('super_admin', 'admin', 'user') DEFAULT 'user' COMMENT '用户角色',
    status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '用户状态',
    avatar_url VARCHAR(255) NULL COMMENT '头像地址',
    token_quota INT DEFAULT 10000 COMMENT 'Token配额',
    used_tokens INT DEFAULT 0 COMMENT '已使用Token',
    last_login_at TIMESTAMP NULL COMMENT '最后登录时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    INDEX idx_email (email),
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 2. 权限表
CREATE TABLE permissions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    permission_type VARCHAR(50) NOT NULL COMMENT '权限类型',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_user_permission (user_id, permission_type),
    INDEX idx_user_id (user_id),
    INDEX idx_permission_type (permission_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户权限表';

-- 3. AI模型配置表 (新增流式输出支持)
CREATE TABLE ai_models (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL COMMENT '模型标识符',
    display_name VARCHAR(200) NOT NULL COMMENT '显示名称',
    provider VARCHAR(50) NOT NULL COMMENT '提供商',
    api_endpoint VARCHAR(500) NULL COMMENT 'API端点',
    model_config JSON NULL COMMENT '模型配置参数',
    stream_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用流式输出',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    sort_order INT DEFAULT 0 COMMENT '排序',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    INDEX idx_name (name),
    INDEX idx_provider (provider),
    INDEX idx_active (is_active),
    INDEX idx_stream (stream_enabled),
    INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型配置表';

-- 4. 对话会话表
CREATE TABLE conversations (
    id VARCHAR(36) PRIMARY KEY COMMENT '会话UUID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    title VARCHAR(255) DEFAULT 'New Chat' COMMENT '会话标题',
    model_name VARCHAR(100) NOT NULL COMMENT '使用的AI模型',
    system_prompt TEXT NULL COMMENT '系统提示词',
    is_pinned BOOLEAN DEFAULT FALSE COMMENT '是否置顶',
    message_count INT DEFAULT 0 COMMENT '消息数量',
    total_tokens INT DEFAULT 0 COMMENT '总Token消耗',
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '最后消息时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_model_name (model_name),
    INDEX idx_created_at (created_at),
    INDEX idx_last_message (last_message_at),
    INDEX idx_user_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表';

-- 5. 消息表
CREATE TABLE messages (
    id VARCHAR(36) PRIMARY KEY COMMENT '消息UUID',
    conversation_id VARCHAR(36) NOT NULL COMMENT '会话ID',
    role ENUM('user', 'assistant', 'system') NOT NULL COMMENT '消息角色',
    content TEXT NOT NULL COMMENT '消息内容',
    tokens INT DEFAULT 0 COMMENT '该消息Token数',
    file_id VARCHAR(36) NULL COMMENT '关联文件ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_conversation_created (conversation_id, created_at),
    INDEX idx_role (role),
    INDEX idx_file_id (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';

-- 6. 文件表
CREATE TABLE files (
    id VARCHAR(36) PRIMARY KEY COMMENT '文件UUID',
    user_id BIGINT NOT NULL COMMENT '上传用户ID',
    conversation_id VARCHAR(36) NULL COMMENT '关联会话ID',
    original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
    stored_name VARCHAR(255) NOT NULL COMMENT '存储文件名',
    file_path VARCHAR(500) NOT NULL COMMENT '文件路径',
    file_size BIGINT NOT NULL COMMENT '文件大小（字节）',
    mime_type VARCHAR(100) NOT NULL COMMENT 'MIME类型',
    extracted_content TEXT NULL COMMENT 'AI提取的文本内容',
    status ENUM('uploading', 'processing', 'ready', 'error') DEFAULT 'uploading' COMMENT '文件状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件表';

-- 7. 使用统计表（可选，用于后续统计分析）
CREATE TABLE usage_stats (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    date DATE NOT NULL COMMENT '统计日期',
    total_messages INT DEFAULT 0 COMMENT '消息总数',
    total_tokens INT DEFAULT 0 COMMENT 'Token总数',
    total_conversations INT DEFAULT 0 COMMENT '会话总数',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_user_date (user_id, date),
    INDEX idx_date (date),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='使用统计表';

-- 创建完成提示
SELECT 'AI Platform 数据库表结构创建完成！' AS message;
