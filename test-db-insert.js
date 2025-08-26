const dbConnection = require('./backend/src/database/connection');

async function test() {
  try {
    // 初始化连接池
    await dbConnection.initialize();
    
    // 测试插入并获取insertId
    const sql = `
      INSERT INTO user_folders (user_id, name, parent_id)
      VALUES (?, ?, ?)
    `;
    
    const result = await dbConnection.query(sql, [4, 'Test Folder ' + Date.now(), null]);
    
    console.log('查询结果结构:');
    console.log('result对象的键:', Object.keys(result));
    console.log('完整result:', JSON.stringify(result, null, 2));
    
    // 尝试不同的方式获取insertId
    console.log('\n尝试获取insertId:');
    console.log('result.insertId:', result.insertId);
    console.log('result.rows:', result.rows);
    if (result.rows && Array.isArray(result.rows)) {
      console.log('result.rows[0]:', result.rows[0]);
      console.log('result.rows.insertId:', result.rows.insertId);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

test();
