#!/usr/bin/env node
/**
 * 数据库智能升级工具
 * 功能：对比当前数据库与目标版本的差异，生成安全的升级SQL
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

class DatabaseUpgrader {
  constructor(config) {
    this.config = config;
    this.connection = null;
  }

  async connect() {
    this.connection = await mysql.createConnection({
      host: this.config.host || 'localhost',
      user: this.config.user,
      password: this.config.password,
      database: this.config.database
    });
    console.log('✅ 已连接到数据库');
  }

  // 获取当前数据库的所有表
  async getCurrentTables() {
    const [rows] = await this.connection.execute('SHOW TABLES');
    return rows.map(row => Object.values(row)[0]);
  }

  // 获取表结构
  async getTableStructure(tableName) {
    const [rows] = await this.connection.execute(`SHOW CREATE TABLE ${tableName}`);
    return rows[0]['Create Table'];
  }

  // 解析目标SQL文件，提取表名
  async getTargetTables(sqlFile) {
    const content = await fs.readFile(sqlFile, 'utf8');
    const tables = [];
    const regex = /CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)`/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      tables.push(match[1]);
    }
    return tables;
  }

  // 从SQL文件提取建表语句
  extractCreateTable(content, tableName) {
    const regex = new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+\`${tableName}\`[^;]+;`, 'gs');
    const match = content.match(regex);
    return match ? match[0] : null;
  }

  // 生成升级SQL
  async generateUpgradeSQL(targetFile) {
    console.log('\n📊 开始分析数据库差异...\n');
    
    // 读取目标SQL文件
    const targetContent = await fs.readFile(targetFile, 'utf8');
    
    // 获取当前和目标表列表
    const currentTables = await this.getCurrentTables();
    const targetTables = await this.getTargetTables(targetFile);
    
    console.log(`当前数据库: ${currentTables.length} 个表`);
    console.log(`目标版本: ${targetTables.length} 个表`);
    
    // 找出需要创建的表
    const missingTables = targetTables.filter(t => !currentTables.includes(t));
    
    if (missingTables.length === 0) {
      console.log('\n✅ 数据库已是最新版本，无需升级');
      return '';
    }
    
    console.log(`\n需要创建 ${missingTables.length} 个新表:`);
    missingTables.forEach(t => console.log(`  - ${t}`));
    
    // 生成创建表的SQL
    let upgradeSQL = '-- 数据库升级脚本\n';
    upgradeSQL += `-- 生成时间: ${new Date().toISOString()}\n`;
    upgradeSQL += `-- 新增表数量: ${missingTables.length}\n\n`;
    
    for (const table of missingTables) {
      const createSQL = this.extractCreateTable(targetContent, table);
      if (createSQL) {
        // 确保使用IF NOT EXISTS
        const safeSQL = createSQL.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS');
        upgradeSQL += `\n${safeSQL}\n`;
      }
    }
    
    return upgradeSQL;
  }

  async close() {
    if (this.connection) {
      await this.connection.end();
      console.log('✅ 数据库连接已关闭');
    }
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('用法: node upgrade.js <目标SQL文件> [--dry-run]');
    console.log('示例: node upgrade.js database/schema/v1.2.0_complete.sql --dry-run');
    process.exit(1);
  }
  
  const targetFile = args[0];
  const isDryRun = args.includes('--dry-run');
  
  // 数据库配置（Docker环境下使用环境变量）
  const config = {
    host: process.env.DB_HOST || 'mysql',
    user: process.env.DB_USER || 'ai_user',
    password: process.env.DB_PASSWORD || 'Nebu@Platform#2025',
    database: process.env.DB_NAME || 'ai_platform'
  };
  
  const upgrader = new DatabaseUpgrader(config);
  
  try {
    await upgrader.connect();
    const sql = await upgrader.generateUpgradeSQL(targetFile);
    
    if (sql) {
      const outputFile = `upgrade_${Date.now()}.sql`;
      await fs.writeFile(outputFile, sql);
      console.log(`\n✅ 升级SQL已生成: ${outputFile}`);
      
      if (!isDryRun) {
        console.log('\n⚠️  准备执行升级（请确保已备份数据库）');
        // 实际执行可以取消注释下面的代码
        // await upgrader.connection.query(sql);
        // console.log('✅ 升级完成！');
      } else {
        console.log('\n📝 Dry-run模式，未实际执行');
      }
    }
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  } finally {
    await upgrader.close();
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

module.exports = DatabaseUpgrader;
