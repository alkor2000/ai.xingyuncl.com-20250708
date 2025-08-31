const axios = require('axios');
const VideoModel = require('./backend/src/models/VideoModel');
const dbConnection = require('./backend/src/database/connection');

async function testVolcanoAPI() {
  try {
    await dbConnection.initialize();
    
    // 获取模型配置
    const modelQuery = `SELECT * FROM video_models WHERE id = 1`;
    const modelResult = await dbConnection.query(modelQuery);
    const model = modelResult.rows[0];
    
    if (!model) {
      console.log('模型不存在');
      return;
    }
    
    // 解密API密钥
    const apiKey = VideoModel.decryptApiKey(model.api_key);
    console.log('API密钥已获取（前10位）:', apiKey ? apiKey.substring(0, 10) + '...' : 'null');
    
    // 查询任务状态
    const taskId = 'cgt-20250831112140-8xkv9';
    const queryUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`;
    
    console.log('\n查询任务状态...');
    console.log('URL:', queryUrl);
    
    try {
      const response = await axios.get(queryUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      });
      
      console.log('\n任务状态响应:');
      console.log(JSON.stringify(response.data, null, 2));
      
      // 如果有视频URL，尝试访问
      if (response.data.video_url) {
        console.log('\n视频URL:', response.data.video_url);
      }
      
    } catch (apiError) {
      console.log('\nAPI调用失败:');
      console.log('状态码:', apiError.response?.status);
      console.log('错误信息:', apiError.response?.data || apiError.message);
    }
    
    await dbConnection.close();
  } catch (error) {
    console.error('错误:', error);
  }
}

testVolcanoAPI();
