const axios = require('axios');
const mysql = require('mysql2/promise');

async function checkRealTaskStatus() {
  let connection;
  try {
    // 连接数据库
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    // 获取最新的运行中任务
    const [tasks] = await connection.execute(
      `SELECT id, task_id, status FROM video_generations WHERE status = 'running' ORDER BY id DESC LIMIT 1`
    );
    
    if (tasks.length === 0) {
      console.log('没有运行中的任务');
      return;
    }
    
    const task = tasks[0];
    console.log('检查任务:', task.task_id);
    
    // 直接调用火山方舟API
    const apiKey = 'f180d2fb-3355-4679-8110-5d398dad3bd3';
    const queryUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${task.task_id}`;
    
    const response = await axios.get(queryUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    console.log('\n任务实际状态:');
    console.log('  状态:', response.data.status);
    console.log('  进度:', response.data.progress);
    
    if (response.data.output) {
      console.log('\n输出信息:');
      console.log('  视频URL:', response.data.output.video_url);
      console.log('  预览图:', response.data.output.preview_image);
    }
    
    console.log('\n完整响应:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('错误:', error.response?.data || error.message);
  } finally {
    if (connection) await connection.end();
  }
}

checkRealTaskStatus();
