/**
 * 测试文档上传功能
 */

const mysql = require('mysql2/promise');

async function testDocumentUpload() {
  let connection;
  
  try {
    // 创建数据库连接
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    console.log('=== 文档上传功能测试 ===\n');
    
    // 1. 查看所有AI模型的文档上传状态
    console.log('1. 当前AI模型的文档上传配置：');
    const [models] = await connection.execute(
      'SELECT id, name, display_name, document_upload_enabled FROM ai_models ORDER BY id'
    );
    
    console.table(models.map(m => ({
      ID: m.id,
      名称: m.name,
      显示名称: m.display_name,
      文档上传: m.document_upload_enabled ? '✅ 已启用' : '❌ 未启用'
    })));
    
    // 2. 测试更新文档上传状态
    if (models.length > 0) {
      const testModel = models[0];
      const newStatus = !testModel.document_upload_enabled;
      
      console.log(`\n2. 测试更新模型 "${testModel.name}" 的文档上传状态：`);
      console.log(`   当前状态: ${testModel.document_upload_enabled ? '已启用' : '未启用'}`);
      console.log(`   新状态: ${newStatus ? '已启用' : '未启用'}`);
      
      await connection.execute(
        'UPDATE ai_models SET document_upload_enabled = ? WHERE id = ?',
        [newStatus, testModel.id]
      );
      
      // 验证更新
      const [updated] = await connection.execute(
        'SELECT document_upload_enabled FROM ai_models WHERE id = ?',
        [testModel.id]
      );
      
      if (updated[0].document_upload_enabled === (newStatus ? 1 : 0)) {
        console.log('   ✅ 更新成功！');
        
        // 恢复原状态
        await connection.execute(
          'UPDATE ai_models SET document_upload_enabled = ? WHERE id = ?',
          [testModel.document_upload_enabled, testModel.id]
        );
        console.log('   ✅ 已恢复原状态');
      } else {
        console.log('   ❌ 更新失败');
      }
    }
    
    // 3. 检查表结构
    console.log('\n3. 检查ai_models表结构：');
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = 'ai_platform' 
       AND TABLE_NAME = 'ai_models' 
       AND COLUMN_NAME = 'document_upload_enabled'`
    );
    
    if (columns.length > 0) {
      console.log('   ✅ document_upload_enabled字段存在');
      console.log(`   类型: ${columns[0].DATA_TYPE}`);
      console.log(`   可空: ${columns[0].IS_NULLABLE}`);
      console.log(`   默认值: ${columns[0].COLUMN_DEFAULT}`);
    } else {
      console.log('   ❌ document_upload_enabled字段不存在');
    }
    
    console.log('\n=== 测试完成 ===');
    
  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 执行测试
testDocumentUpload();
