#!/usr/bin/env node

/**
 * 创建AI Platform数据库
 */

const mysql = require('mysql2/promise');

// 连接MySQL服务器（不指定数据库）
const DB_CONFIG = {
    host: 'localhost',
    user: 'ai_user',
    password: 'AiPlatform@2025!',
    charset: 'utf8mb4'
};

async function createDatabase() {
    let connection;
    
    try {
        console.log('🚀 开始创建AI Platform数据库...\n');
        
        // 连接MySQL服务器
        console.log('📡 连接MySQL服务器...');
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ MySQL服务器连接成功\n');
        
        // 创建数据库
        console.log('📋 创建数据库 ai_platform...');
        await connection.execute(`
            CREATE DATABASE IF NOT EXISTS ai_platform 
            CHARACTER SET utf8mb4 
            COLLATE utf8mb4_unicode_ci
        `);
        console.log('✅ 数据库 ai_platform 创建成功\n');
        
        // 验证数据库创建
        const [databases] = await connection.execute('SHOW DATABASES LIKE "ai_platform"');
        if (databases.length > 0) {
            console.log('🎉 数据库创建验证成功！');
        } else {
            throw new Error('数据库创建验证失败');
        }
        
    } catch (error) {
        console.error('\n❌ 数据库创建失败:');
        console.error(error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('📡 MySQL连接已关闭\n');
        }
    }
}

// 执行创建
if (require.main === module) {
    createDatabase();
}

module.exports = { createDatabase };
