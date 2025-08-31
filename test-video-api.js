/**
 * 测试视频生成API
 */
const axios = require('axios');

const API_URL = 'https://ai.xingyuncl.com/api';
const TEST_USER = 'admin';
const TEST_PASSWORD = '123456';

async function test() {
  try {
    console.log('1. 登录获取token...');
    const loginRes = await axios.post(
      `${API_URL}/auth/login`,
      {
        account: TEST_USER,  // 使用account字段而不是username
        password: TEST_PASSWORD
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    const token = loginRes.data.data.accessToken;  // 注意是accessToken不是access_token
    console.log('✓ 登录成功');
    console.log('  Token:', token.substring(0, 20) + '...');
    
    console.log('\n2. 获取视频模型列表...');
    const modelsRes = await axios.get(`${API_URL}/video/models`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const models = modelsRes.data.data;
    console.log(`✓ 获取到 ${models.length} 个视频模型`);
    
    if (models.length > 0) {
      const model = models[0];
      console.log('\n模型信息:');
      console.log(`  - ID: ${model.id}`);
      console.log(`  - 名称: ${model.display_name}`);
      console.log(`  - 提供商: ${model.provider}`);
      console.log(`  - 模型ID: ${model.model_id}`);
      console.log(`  - 支持分辨率: ${model.resolutions_supported.join(', ')}`);
      console.log(`  - 支持时长: ${model.durations_supported.join(', ')}秒`);
      console.log(`  - 基础价格: ${model.base_price} 积分`);
      console.log(`  - 支持文生视频: ${model.supports_text_to_video ? '是' : '否'}`);
      console.log(`  - 支持图生视频: ${model.supports_image_to_video ? '是' : '否'}`);
      console.log(`  - 支持首帧: ${model.supports_first_frame ? '是' : '否'}`);
      console.log(`  - 有API密钥: ${model.has_api_key ? '是' : '否'}`);
    }
    
    console.log('\n3. 获取用户视频统计...');
    const statsRes = await axios.get(`${API_URL}/video/stats`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✓ 统计信息:', statsRes.data.data);
    
    console.log('\n4. 获取视频生成历史...');
    const historyRes = await axios.get(`${API_URL}/video/history?page=1&limit=5`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✓ 历史记录: 共 ${historyRes.data.data.pagination.total} 条记录`);
    
    console.log('\n✅ 视频生成API测试成功！');
    console.log('\n注意：视频模型需要配置API密钥才能使用');
    console.log('请通过管理界面配置模型的API密钥');
    
  } catch (error) {
    console.error('❌ 测试失败:');
    if (error.response) {
      console.error('  状态码:', error.response.status);
      console.error('  响应数据:', error.response.data);
    } else {
      console.error('  错误信息:', error.message);
    }
  }
}

test();
