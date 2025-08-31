const mysql = require('mysql2/promise');

async function fixRunningTask() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    // 获取视频URL
    const videoUrl = "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-1-0-pro/02175661249578700000000000000000000ffffac144da8a61e7b.mp4?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=AKLTYWJkZTExNjA1ZDUyNDc3YzhjNTM5OGIyNjBhNDcyOTQ%2F20250831%2Fcn-beijing%2Ftos%2Frequest&X-Tos-Date=20250831T035549Z&X-Tos-Expires=86400&X-Tos-Signature=e5faa3959ad06e7c7de321a55d530dfcd6125dcc71a362fa2446f682b44c1cac&X-Tos-SignedHeaders=host";
    
    // 更新任务状态
    await connection.execute(
      `UPDATE video_generations 
       SET status = 'succeeded', 
           video_url = ?,
           local_path = ?,
           completed_at = NOW(),
           generation_time = 120
       WHERE task_id = 'cgt-20250831115455-rlrbn'`,
      [videoUrl, videoUrl]
    );
    
    console.log('✓ 任务状态已修复');
    
  } catch (error) {
    console.error('错误:', error);
  } finally {
    if (connection) await connection.end();
  }
}

fixRunningTask();
