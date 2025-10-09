const axios = require('axios');

// 模拟系统发送请求
async function testSystemRequest() {
  console.log('模拟系统请求 sora-2-pro...\n');
  
  // 系统可能发送的参数
  const testCases = [
    {
      name: '测试1: 基础参数（系统默认）',
      data: {
        model: 'sora-2-pro',
        orientation: 'landscape',
        prompt: '一位金发碧眼美女在马尔代夫海边划着浆板'
      }
    },
    {
      name: '测试2: 带分辨率参数',
      data: {
        model: 'sora-2-pro',
        orientation: 'landscape',
        prompt: '一位金发碧眼美女在马尔代夫海边划着浆板',
        resolution: '640x352'
      }
    },
    {
      name: '测试3: 带时长参数',
      data: {
        model: 'sora-2-pro',
        orientation: 'landscape',
        prompt: '一位金发碧眼美女在马尔代夫海边划着浆板',
        duration: 5
      }
    },
    {
      name: '测试4: 竖屏',
      data: {
        model: 'sora-2-pro',
        orientation: 'portrait',
        prompt: '一位金发碧眼美女在马尔代夫海边划着浆板'
      }
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('参数:', JSON.stringify(testCase.data, null, 2));
    
    try {
      const response = await axios.post(
        'https://goapi.gptnb.ai/sora2/v1/create',
        testCase.data,
        {
          headers: {
            'Authorization': 'Bearer sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b',
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('✅ 成功:', response.data);
    } catch (error) {
      console.log('❌ 失败');
      console.log('状态码:', error.response?.status);
      console.log('错误:', JSON.stringify(error.response?.data, null, 2));
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
}

testSystemRequest();
