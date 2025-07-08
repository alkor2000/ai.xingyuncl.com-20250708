#!/usr/bin/env node

/**
 * AI Platform 数据库初始化脚本
 * 逐步执行SQL语句避免多语句问题
 */

const mysql = require('mysql2/promise');

// 数据库配置
const DB_CONFIG = {
    host: 'localhost',
    user: 'ai_user',
    password: 'AiPlatform@2025!',
    database: 'ai_platform',
    charset: 'utf8mb4'
};

async function initDatabase() {
    let connection;
    
    try {
        console.log('🚀 开始初始化AI Platform数据库...\n');
        
        // 创建数据库连接
        console.log('📡 连接数据库...');
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ 数据库连接成功\n');
        
        console.log('🗑️ 清理已存在的表...');
        // 按依赖关系顺序删除表
        const dropTables = [
            'DROP TABLE IF EXISTS usage_stats',
            'DROP TABLE IF EXISTS files', 
            'DROP TABLE IF EXISTS messages',
            'DROP TABLE IF EXISTS conversations',
            'DROP TABLE IF EXISTS permissions',
            'DROP TABLE IF EXISTS ai_models',
            'DROP TABLE IF EXISTS users'
        ];
        
        for (const sql of dropTables) {
            await connection.execute(sql);
        }
        console.log('✅ 清理完成\n');
        
        console.log('📋 创建数据库表结构...');
        
        // 1. 创建用户表
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
        `);
        console.log('✅ users表创建成功');
        
        // 2. 创建权限表
        await connection.execute(`
            CREATE TABLE permissions (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                user_id BIGINT NOT NULL COMMENT '用户ID',
                permission_type VARCHAR(50) NOT NULL COMMENT '权限类型',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY uk_user_permission (user_id, permission_type),
                INDEX idx_user_id (user_id),
                INDEX idx_permission_type (permission_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户权限表'
        `);
        console.log('✅ permissions表创建成功');
        
        // 3. 创建AI模型配置表
        await connection.execute(`
            CREATE TABLE ai_models (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) UNIQUE NOT NULL COMMENT '模型标识符',
                display_name VARCHAR(200) NOT NULL COMMENT '显示名称',
                provider VARCHAR(50) NOT NULL COMMENT '提供商',
                api_endpoint VARCHAR(500) NULL COMMENT 'API端点',
                model_config JSON NULL COMMENT '模型配置参数',
                is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
                sort_order INT DEFAULT 0 COMMENT '排序',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                
                INDEX idx_name (name),
                INDEX idx_provider (provider),
                INDEX idx_active (is_active),
                INDEX idx_sort (sort_order)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型配置表'
        `);
        console.log('✅ ai_models表创建成功');
        
        // 4. 创建对话会话表
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表'
        `);
        console.log('✅ conversations表创建成功');
        
        // 5. 创建消息表
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表'
        `);
        console.log('✅ messages表创建成功');
        
        // 6. 创建文件表
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件表'
        `);
        console.log('✅ files表创建成功');
        
        // 7. 创建使用统计表
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='使用统计表'
        `);
        console.log('✅ usage_stats表创建成功');
        
        console.log('\n📊 插入初始数据...');
        
        // 插入超级管理员用户 (密码: admin123)
        const [userResult] = await connection.execute(`
            INSERT INTO users (email, username, password_hash, role, status, token_quota) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            'admin@ai.xingyuncl.com', 
            'superadmin', 
            '\$2a\$12$LQv3c1yqBw100dQyTOJ/PeBnf1TJIb.N5J97UVc.wXd6QYgbPSmvC', 
            'super_admin', 
            'active', 
            1000000
        ]);
        const superAdminId = userResult.insertId;
        console.log(`✅ 超级管理员创建成功, ID: ${superAdminId}`);
        
        // 插入超级管理员权限
        const adminPermissions = [
            'system.all', 'user.manage', 'admin.manage', 
            'chat.unlimited', 'file.unlimited', 'stats.view'
        ];
        
        for (const permission of adminPermissions) {
            await connection.execute(`
                INSERT INTO permissions (user_id, permission_type) VALUES (?, ?)
            `, [superAdminId, permission]);
        }
        console.log('✅ 超级管理员权限设置完成');
        
        // 插入默认AI模型
        const aiModels = [
            ['gpt-3.5-turbo', 'GPT-3.5 Turbo', 'openai', '{"max_tokens": 4096, "temperature": 0.7}', 1],
            ['gpt-4', 'GPT-4', 'openai', '{"max_tokens": 8192, "temperature": 0.7}', 2],
            ['gpt-4-turbo', 'GPT-4 Turbo', 'openai', '{"max_tokens": 128000, "temperature": 0.7}', 3],
            ['claude-3-haiku', 'Claude 3 Haiku', 'anthropic', '{"max_tokens": 4096, "temperature": 0.7}', 4],
            ['claude-3-sonnet', 'Claude 3 Sonnet', 'anthropic', '{"max_tokens": 4096, "temperature": 0.7}', 5],
            ['claude-3-opus', 'Claude 3 Opus', 'anthropic', '{"max_tokens": 4096, "temperature": 0.7}', 6]
        ];
        
        for (const model of aiModels) {
            await connection.execute(`
                INSERT INTO ai_models (name, display_name, provider, model_config, is_active, sort_order) 
                VALUES (?, ?, ?, ?, ?, ?)
            `, [...model, true]);
        }
        console.log('✅ AI模型配置插入完成');
        
        // 创建测试用户 (密码: admin123)
        const [testUserResult] = await connection.execute(`
            INSERT INTO users (email, username, password_hash, role, status, token_quota) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            'user@example.com', 
            'testuser', 
            '\$2a\$12$LQv3c1yqBw100dQyTOJ/PeBnf1TJIb.N5J97UVc.wXd6QYgbPSmvC', 
            'user', 
            'active', 
            10000
        ]);
        const testUserId = testUserResult.insertId;
        
        // 插入普通用户权限
        const userPermissions = ['chat.use', 'file.upload'];
        for (const permission of userPermissions) {
            await connection.execute(`
                INSERT INTO permissions (user_id, permission_type) VALUES (?, ?)
            `, [testUserId, permission]);
        }
        console.log('✅ 测试用户创建完成');
        
        // 验证数据
        console.log('\n🔍 验证初始化结果...');
        const [tables] = await connection.execute('SHOW TABLES');
        const [userCount] = await connection.execute('SELECT COUNT(*) as count FROM users');
        const [modelCount] = await connection.execute('SELECT COUNT(*) as count FROM ai_models');
        const [permissionCount] = await connection.execute('SELECT COUNT(*) as count FROM permissions');
        
        console.log(`✅ 数据表数量: ${tables.length}`);
        console.log(`✅ 用户数量: ${userCount[0].count}`);
        console.log(`✅ AI模型数量: ${modelCount[0].count}`);
        console.log(`✅ 权限数量: ${permissionCount[0].count}`);
        
        console.log('\n🎉 AI Platform数据库初始化完成！');
        console.log('📧 超级管理员: admin@ai.xingyuncl.com');
        console.log('🔑 密码: admin123');
        console.log('📧 测试用户: user@example.com');
        console.log('🔑 密码: admin123');
        
    } catch (error) {
        console.error('\n❌ 数据库初始化失败:');
        console.error(error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n📡 数据库连接已关闭');
        }
    }
}

// 执行初始化
if (require.main === module) {
    initDatabase();
}

module.exports = { initDatabase };
