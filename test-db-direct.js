const mysql = require('mysql2/promise');

async function testDirectSQL() {
  let connection;
  try {
    // 直接连接数据库
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    console.log('✓ 数据库连接成功\n');
    
    // 1. 测试简单查询
    console.log('1. 测试简单查询:');
    const [rows1] = await connection.execute('SELECT COUNT(*) as total FROM video_generations WHERE user_id = ?', [4]);
    console.log('   总记录数:', rows1[0].total);
    
    // 2. 测试带LIMIT的查询
    console.log('\n2. 测试带LIMIT的查询:');
    const userId = 4;
    const limit = 20;
    const offset = 0;
    
    const [rows2] = await connection.execute(
      `SELECT vg.*, vm.display_name as model_name 
       FROM video_generations vg 
       LEFT JOIN video_models vm ON vg.model_id = vm.id 
       WHERE vg.user_id = ? 
       ORDER BY vg.created_at DESC 
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
    
    console.log('   返回记录数:', rows2.length);
    if (rows2.length > 0) {
      console.log('   第一条记录ID:', rows2[0].id);
      console.log('   状态:', rows2[0].status);
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error('错误代码:', error.code);
    console.error('SQL状态:', error.sqlState);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

testDirectSQL();
