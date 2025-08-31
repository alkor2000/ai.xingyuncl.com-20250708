const dbConnection = require('./backend/src/database/connection');

async function checkTask() {
  try {
    await dbConnection.initialize();
    
    // 查询最新的视频生成记录
    const query = `
      SELECT id, task_id, status, video_url, error_message, created_at, updated_at
      FROM video_generations 
      ORDER BY id DESC 
      LIMIT 5
    `;
    
    const result = await dbConnection.query(query);
    
    console.log('最新的视频生成记录:');
    result.rows.forEach(row => {
      console.log('\n记录ID:', row.id);
      console.log('  任务ID:', row.task_id);
      console.log('  状态:', row.status);
      console.log('  视频URL:', row.video_url);
      console.log('  错误信息:', row.error_message);
      console.log('  创建时间:', row.created_at);
      console.log('  更新时间:', row.updated_at);
    });
    
    await dbConnection.close();
  } catch (error) {
    console.error('错误:', error);
  }
}

checkTask();
