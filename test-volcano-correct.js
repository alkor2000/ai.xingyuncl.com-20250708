const axios = require('axios');

async function testVolcanoAPI() {
  try {
    const apiKey = 'ark-zcRnzBieBSo8x0RNfJBqkANhCb9ijFq3FdOl4VQVzIRqDWRxkLp';
    
    console.log('测试火山方舟API的不同格式...\n');
    
    // 测试1: 创建新的视频生成任务（使用正确的格式）
    console.log('1. 测试创建视频任务:');
    
    const createUrl = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
    
    try {
      const response = await axios.post(
        createUrl,
        {
          model: 'doubao-seedance-1-0-pro-250528',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: '一只可爱的猫咪在花园里玩耍'
                }
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 30000
        }
      );
      
      console.log('✓ 任务创建成功！');
      console.log('任务ID:', response.data.id);
      console.log('响应:', JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      console.log('✗ 创建失败');
      console.log('状态码:', error.response?.status);
      console.log('错误:', JSON.stringify(error.response?.data, null, 2));
      
      if (error.response?.status === 401) {
        console.log('\n可能的原因:');
        console.log('1. API密钥错误或已过期');
        console.log('2. API密钥没有视频生成权限');
        console.log('3. 需要在火山引擎控制台启用相关服务');
      }
    }
    
  } catch (error) {
    console.error('错误:', error.message);
  }
}

testVolcanoAPI();
