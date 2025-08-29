/**
 * 测试图像生成OSS存储
 */
const axios = require('axios');

const API_URL = 'https://ai.xingyuncl.com/api';
const TEST_USER = 'admin';
const TEST_PASSWORD = '123456';

async function test() {
  try {
    console.log('1. 登录获取token...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      username: TEST_USER,
      password: TEST_PASSWORD
    });
    
    const token = loginRes.data.data.access_token;
    console.log('✓ 登录成功');
    
    console.log('\n2. 获取可用模型...');
    const modelsRes = await axios.get(`${API_URL}/image/models`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const models = modelsRes.data.data;
    console.log(`✓ 获取到 ${models.length} 个模型`);
    
    if (models.length === 0) {
      console.log('⚠ 没有可用的图像模型');
      return;
    }
    
    const model = models[0];
    console.log(`  使用模型: ${model.display_name} (ID: ${model.id})`);
    
    console.log('\n3. 生成测试图片...');
    const generateRes = await axios.post(`${API_URL}/image/generate`, {
      model_id: model.id,
      prompt: 'A beautiful sunset over mountains, test image for OSS storage',
      size: '1024x1024'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const result = generateRes.data.data;
    console.log('✓ 图片生成成功');
    console.log(`  图片ID: ${result.id}`);
    console.log(`  原图路径: ${result.local_path}`);
    console.log(`  缩略图路径: ${result.thumbnail_path}`);
    
    // 检查路径格式
    if (result.local_path.includes('/generations/')) {
      const match = result.local_path.match(/generations\/(\d+)\//);
      if (match) {
        console.log(`  ✓ 用户ID目录: ${match[1]}`);
      }
    }
    
    console.log('\n4. 验证图片访问...');
    // 尝试访问图片URL
    try {
      const imageRes = await axios.head(result.local_path.startsWith('http') 
        ? result.local_path 
        : `https://ai.xingyuncl.com${result.local_path}`);
      console.log(`  ✓ 图片可访问 (${imageRes.headers['content-type']})`);
    } catch (e) {
      console.log(`  ⚠ 图片访问测试失败: ${e.message}`);
    }
    
    console.log('\n✅ 测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.response?.data || error.message);
  }
}

test();
