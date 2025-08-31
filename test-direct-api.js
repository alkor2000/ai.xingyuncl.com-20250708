const axios = require('axios');

async function testDirectAPI() {
  try {
    // 直接使用API密钥
    const apiKey = 'ark-zcRnzBieBSo8x0RNfJBqkANhCb9ijFq3FdOl4VQVzIRqDWRxkLp';
    const taskId = 'cgt-20250831112140-8xkv9';
    
    console.log('直接测试火山方舟API...\n');
    console.log('任务ID:', taskId);
    
    // 查询任务状态
    const queryUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`;
    
    try {
      const response = await axios.get(queryUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      });
      
      console.log('\n✓ API调用成功！');
      console.log('\n任务详情:');
      console.log('  状态:', response.data.status);
      console.log('  进度:', response.data.progress);
      
      if (response.data.output) {
        console.log('\n输出信息:');
        console.log('  视频URL:', response.data.output.video_url || '无');
        console.log('  预览图:', response.data.output.preview_image || '无');
      }
      
      if (response.data.error) {
        console.log('\n错误信息:', response.data.error);
      }
      
      console.log('\n完整响应:');
      console.log(JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      console.log('\n✗ API调用失败');
      console.log('状态码:', error.response?.status);
      console.log('错误:', error.response?.data || error.message);
    }
    
  } catch (error) {
    console.error('错误:', error);
  }
}

testDirectAPI();
