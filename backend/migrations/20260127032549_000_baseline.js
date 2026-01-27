/**
 * 基线迁移 - 包含现有所有89张表的结构
 * 
 * 说明：
 * - 新客户部署时：自动创建所有表
 * - 现有服务器：手动标记为已执行（不实际运行）
 * 
 * 创建时间：2026-01-27
 * 表数量：89张
 */

const fs = require('fs');
const path = require('path');

exports.up = async function(knex) {
  // 读取基线SQL文件
  const sqlPath = path.join(__dirname, '000_baseline.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  // 按分号分割成多个语句执行
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('/*') && !s.startsWith('--'));
  
  for (const statement of statements) {
    if (statement.includes('CREATE TABLE')) {
      // 添加 IF NOT EXISTS 防止重复创建报错
      const safeStatement = statement.replace(
        'CREATE TABLE',
        'CREATE TABLE IF NOT EXISTS'
      );
      await knex.raw(safeStatement);
    }
  }
  
  console.log('基线迁移完成：89张表');
};

exports.down = async function(knex) {
  // 基线迁移不支持回滚（太危险）
  console.log('警告：基线迁移不支持回滚');
};
