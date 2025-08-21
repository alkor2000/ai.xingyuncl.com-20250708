/**
 * 测试 simple 接口
 */

const axios = require('axios');

const API_BASE_URL = 'https://goapi.gptnb.ai';
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b';

async function testSimpleImagine() {
  console.log('测试 simple imagine 接口...\n');
  
  try {
    // 使用最简单的提示词
    const response = await axios.post(
      `${API_BASE_URL}/mj/submit/imagine`,
      {
        prompt: 'cat'  // 极简提示词
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('提交响应:', response.data);
    
    if (response.data.code === 1) {
      const taskId = response.data.result;
      
      // 等待30秒
      console.log('\n等待30秒...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // 查询最终状态
      const statusResponse = await axios.get(
        `${API_BASE_URL}/mj/task/${taskId}/fetch`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`
          }
        }
      );
      
      console.log('\n最终状态:');
      console.log(JSON.stringify(statusResponse.data, null, 2));
    }
    
  } catch (error) {
    console.log('错误:', error.message);
    if (error.response) {
      console.log('响应:', error.response.data);
    }
  }
}

testSimpleImagine();
