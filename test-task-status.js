/**
 * 测试查询具体任务状态
 */

const axios = require('axios');

const API_BASE_URL = 'https://goapi.gptnb.ai';
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b';

// 这些是失败的任务ID（从日志中看到的）
const taskIds = [
  '1755793410873734',  // 最近失败的
  '1755795335140639'   // 我们刚才测试创建的
];

async function checkTaskStatus() {
  for (const taskId of taskIds) {
    console.log(`\n查询任务: ${taskId}`);
    console.log('----------------------------------------');
    
    try {
      const response = await axios.get(
        `${API_BASE_URL}/mj/task/${taskId}/fetch`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`
          },
          timeout: 10000
        }
      );
      
      console.log('任务详情:');
      console.log(JSON.stringify(response.data, null, 2));
      
      // 特别关注这些字段
      console.log('\n关键字段:');
      console.log('- status:', response.data.status);
      console.log('- failReason:', response.data.failReason);
      console.log('- progress:', response.data.progress);
      console.log('- imageUrl:', response.data.imageUrl);
      console.log('- action:', response.data.action);
      
    } catch (error) {
      console.log('查询失败:', error.message);
      if (error.response) {
        console.log('响应:', error.response.data);
      }
    }
  }
}

checkTaskStatus();
