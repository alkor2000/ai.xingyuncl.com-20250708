const mysql = require('mysql2/promise');

async function testLimitFix() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    console.log('测试LIMIT和OFFSET的不同处理方式:\n');
    
    const userId = 4;
    const limit = 20;
    const offset = 0;
    
    // 方法1: 使用query而不是execute
    console.log('1. 使用query方法:');
    try {
      const [rows1] = await connection.query(
        `SELECT vg.id, vg.status FROM video_generations vg WHERE vg.user_id = ? LIMIT ? OFFSET ?`,
        [userId, limit, offset]
      );
      console.log('   ✓ query方法成功，返回', rows1.length, '条记录');
    } catch (err) {
      console.log('   ✗ query方法失败:', err.message);
    }
    
    // 方法2: 将LIMIT和OFFSET直接拼接到SQL中
    console.log('\n2. 直接拼接LIMIT和OFFSET:');
    try {
      const [rows2] = await connection.execute(
        `SELECT vg.id, vg.status FROM video_generations vg WHERE vg.user_id = ? LIMIT ${limit} OFFSET ${offset}`,
        [userId]
      );
      console.log('   ✓ 拼接方法成功，返回', rows2.length, '条记录');
    } catch (err) {
      console.log('   ✗ 拼接方法失败:', err.message);
    }
    
  } catch (error) {
    console.error('错误:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

testLimitFix();
