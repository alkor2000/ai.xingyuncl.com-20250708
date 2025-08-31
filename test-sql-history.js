const dbConnection = require('./backend/src/database/connection');

async function testSQL() {
  try {
    console.log('测试SQL查询...\n');
    
    // 测试用户ID为1的历史记录查询
    const userId = 1;
    const page = 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // 1. 测试计数查询
    console.log('1. 测试计数查询:');
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM video_generations vg
      WHERE vg.user_id = ?
    `;
    
    try {
      const countResult = await dbConnection.query(countQuery, [userId]);
      console.log('✓ 计数查询成功，总数:', countResult.rows[0].total);
    } catch (err) {
      console.log('✗ 计数查询失败:', err.message);
    }
    
    // 2. 测试数据查询
    console.log('\n2. 测试数据查询:');
    const dataQuery = `
      SELECT vg.*, vm.display_name as model_name, vm.provider, vm.generation_type
      FROM video_generations vg
      LEFT JOIN video_models vm ON vg.model_id = vm.id
      WHERE vg.user_id = ?
      ORDER BY vg.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    try {
      const dataResult = await dbConnection.query(dataQuery, [userId, limit, offset]);
      console.log('✓ 数据查询成功，返回', dataResult.rows.length, '条记录');
    } catch (err) {
      console.log('✗ 数据查询失败:', err.message);
    }
    
    // 3. 测试公开画廊查询
    console.log('\n3. 测试公开画廊查询:');
    const galleryQuery = `
      SELECT vg.*, vm.display_name as model_name, vm.provider,
             u.username, u.nickname
      FROM video_generations vg
      LEFT JOIN video_models vm ON vg.model_id = vm.id
      LEFT JOIN users u ON vg.user_id = u.id
      WHERE vg.is_public = 1 AND vg.status = 'succeeded'
      ORDER BY vg.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    try {
      const galleryResult = await dbConnection.query(galleryQuery, [limit, offset]);
      console.log('✓ 公开画廊查询成功，返回', galleryResult.rows.length, '条记录');
    } catch (err) {
      console.log('✗ 公开画廊查询失败:', err.message);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

testSQL();
