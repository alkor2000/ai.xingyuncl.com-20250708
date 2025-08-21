/**
 * 测试英文提示词
 */

const axios = require('axios');

const API_BASE_URL = 'https://goapi.gptnb.ai';
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b';

async function testEnglishPrompt() {
  console.log('测试纯英文提示词...\n');
  
  try {
    // 1. 提交任务
    console.log('提交任务...');
    const response = await axios.post(
      `${API_BASE_URL}/mj/submit/imagine`,
      {
        prompt: 'beautiful landscape with mountains and lake, golden hour lighting, photorealistic --v 6 --ar 16:9'
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    console.log('提交响应:', response.data);
    
    if (response.data.code === 1) {
      const taskId = response.data.result;
      console.log(`\n任务ID: ${taskId}`);
      console.log('等待10秒后查询状态...\n');
      
      // 2. 等待并查询状态
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const statusResponse = await axios.get(
        `${API_BASE_URL}/mj/task/${taskId}/fetch`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`
          }
        }
      );
      
      console.log('任务状态:');
      console.log('- status:', statusResponse.data.status);
      console.log('- progress:', statusResponse.data.progress);
      console.log('- imageUrl:', statusResponse.data.imageUrl);
      console.log('- failReason:', statusResponse.data.failReason);
      
      // 3. 如果还在处理，继续等待
      if (statusResponse.data.status === 'IN_PROGRESS') {
        console.log('\n任务仍在处理，再等20秒...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        
        const finalStatus = await axios.get(
          `${API_BASE_URL}/mj/task/${taskId}/fetch`,
          {
            headers: {
              'Authorization': `Bearer ${API_KEY}`
            }
          }
        );
        
        console.log('\n最终状态:');
        console.log('- status:', finalStatus.data.status);
        console.log('- imageUrl:', finalStatus.data.imageUrl);
        console.log('- failReason:', finalStatus.data.failReason);
      }
    }
  } catch (error) {
    console.log('错误:', error.message);
    if (error.response) {
      console.log('响应:', error.response.data);
    }
  }
}

testEnglishPrompt();
