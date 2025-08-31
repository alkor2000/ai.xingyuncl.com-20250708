const axios = require('axios');

async function testOfficialAPI() {
  try {
    const apiKey = 'ark-zcRnzBieBSo8x0RNfJBqkANhCb9ijFq3FdOl4VQVzIRqDWRxkLp';
    
    console.log('使用官方文档格式测试火山方舟视频API...\n');
    
    const createUrl = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
    
    // 使用官方文档的正确格式
    const requestData = {
      model: 'doubao-seedance-1-0-pro-250528',
      content: [
        {
          type: 'text',
          text: '一只可爱的猫咪在花园里玩耍 --rs 720p --rt 16:9 --dur 5'
        }
      ]
    };
    
    console.log('请求数据:', JSON.stringify(requestData, null, 2));
    console.log('\n发送请求...');
    
    try {
      const response = await axios.post(
        createUrl,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 30000
        }
      );
      
      console.log('\n✓ 任务创建成功！');
      console.log('任务ID:', response.data.id);
      console.log('完整响应:', JSON.stringify(response.data, null, 2));
      
      return response.data.id;
      
    } catch (error) {
      console.log('\n✗ 请求失败');
      console.log('状态码:', error.response?.status);
      
      if (error.response?.status === 401) {
        console.log('\nAPI密钥验证失败，可能的原因：');
        console.log('1. API密钥格式错误或已过期');
        console.log('2. 未在火山引擎控制台开通视频生成服务');
        console.log('3. API密钥没有视频生成权限');
        console.log('\n请检查：');
        console.log('- 登录火山引擎控制台：https://console.volcengine.com/');
        console.log('- 进入"火山方舟"服务');
        console.log('- 确认已开通"视频生成"功能');
        console.log('- 检查API密钥是否正确且有效');
      }
      
      console.log('\n错误详情:', JSON.stringify(error.response?.data, null, 2));
    }
    
  } catch (error) {
    console.error('程序错误:', error.message);
  }
}

testOfficialAPI();
