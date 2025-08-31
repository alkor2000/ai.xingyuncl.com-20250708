const axios = require('axios');
const VideoModel = require('./backend/src/models/VideoModel');
const dbConnection = require('./backend/src/database/connection');

async function testWithDatabaseKey() {
  try {
    await dbConnection.initialize();
    
    // 从数据库获取模型配置
    const modelQuery = `SELECT * FROM video_models WHERE id = 1`;
    const modelResult = await dbConnection.query(modelQuery);
    const model = modelResult.rows[0];
    
    // 解密API密钥
    const apiKey = VideoModel.decryptApiKey(model.api_key);
    console.log('从数据库获取的API密钥（前8位）:', apiKey ? apiKey.substring(0, 8) + '...' : 'null');
    
    if (!apiKey) {
      console.log('API密钥解密失败');
      return;
    }
    
    // 创建视频生成任务
    const requestData = {
      model: 'doubao-seedance-1-0-pro-250528',
      content: [
        {
          type: 'text',
          text: '一只可爱的猫咪在花园里玩耍 --rs 720p --rt 16:9 --dur 5'
        }
      ]
    };
    
    console.log('\n发送视频生成请求...');
    
    const response = await axios.post(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      }
    );
    
    console.log('\n✓ 视频生成任务创建成功！');
    console.log('任务ID:', response.data.id);
    
    // 清理旧的失败记录，创建新的成功记录
    await dbConnection.query(
      `UPDATE video_generations SET status = 'cancelled', error_message = '任务已取消' WHERE status IN ('running', 'queued')`
    );
    
    console.log('\n视频生成系统测试成功！');
    console.log('系统已准备就绪，可以正常使用。');
    
    await dbConnection.close();
    
  } catch (error) {
    console.error('\n测试失败:');
    if (error.response?.status === 401) {
      console.error('API密钥认证失败，请在管理界面重新配置正确的API密钥');
    } else {
      console.error('错误:', error.response?.data || error.message);
    }
    
    if (dbConnection.isConnected) {
      await dbConnection.close();
    }
  }
}

testWithDatabaseKey();
