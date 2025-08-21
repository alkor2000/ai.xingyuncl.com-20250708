/**
 * 查询任务最终状态
 */

const axios = require('axios');

const API_BASE_URL = 'https://goapi.gptnb.ai';
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b';

// 需要查询的任务ID
const taskIds = [
  '1755795888370416',  // 刚才测试的英文提示词
  '1755795666043616',  // 中文"嘟嘟猫"
  '1755793336981321'   // 成功的UPSCALE
];

async function checkFinalStatus() {
  for (const taskId of taskIds) {
    console.log(`\n查询任务: ${taskId}`);
    console.log('----------------------------------------');
    
    try {
      const response = await axios.get(
        `${API_BASE_URL}/mj/task/${taskId}/fetch`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`
          }
        }
      );
      
      const data = response.data;
      console.log('状态:', data.status);
      console.log('进度:', data.progress);
      console.log('动作:', data.action);
      console.log('提示词:', data.prompt);
      console.log('图片URL:', data.imageUrl ? '有' : '无');
      console.log('失败原因:', data.failReason || '无');
      console.log('properties.messageContent:', data.properties?.messageContent || '无');
      console.log('properties.discordChannelId:', data.properties?.discordChannelId);
      
    } catch (error) {
      console.log('查询失败:', error.message);
    }
  }
}

checkFinalStatus();
