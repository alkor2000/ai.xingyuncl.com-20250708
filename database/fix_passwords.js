#!/usr/bin/env node

/**
 * 修复用户密码为明文（临时调试用）
 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
    host: 'localhost',
    user: 'ai_user',
    password: 'AiPlatform@2025!',
    database: 'ai_platform',
    charset: 'utf8mb4'
};

async function fixPasswords() {
    let connection;
    
    try {
        console.log('🔧 开始修复用户密码...\n');
        
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ 数据库连接成功\n');
        
        // 更新超级管理员密码为明文
        await connection.execute(`
            UPDATE users SET password_hash = 'admin123' 
            WHERE email = 'admin@ai.xingyuncl.com'
        `);
        console.log('✅ 超级管理员密码已更新为: admin123');
        
        // 更新测试用户密码为明文
        await connection.execute(`
            UPDATE users SET password_hash = 'admin123' 
            WHERE email = 'user@example.com'
        `);
        console.log('✅ 测试用户密码已更新为: admin123');
        
        // 检查所有用户
        const [users] = await connection.execute('SELECT email, username, password_hash FROM users');
        
        console.log('\n📋 当前用户列表:');
        users.forEach(user => {
            console.log(`📧 ${user.email} | 👤 ${user.username} | 🔑 ${user.password_hash}`);
        });
        
        console.log('\n🎉 密码修复完成！');
        
    } catch (error) {
        console.error('\n❌ 密码修复失败:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('📡 数据库连接已关闭');
        }
    }
}

if (require.main === module) {
    fixPasswords();
}
