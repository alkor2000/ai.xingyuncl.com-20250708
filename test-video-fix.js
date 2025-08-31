const axios = require('axios');

async function test() {
  try {
    // 1. 登录
    console.log('登录中...');
    const loginRes = await axios.post('https://ai.xingyuncl.com/api/auth/login', {
      account: 'admin',
      password: '123456'
    });
    
    const token = loginRes.data.data.accessToken;
    console.log('✓ 登录成功\n');
    
    // 2. 获取视频模型列表
    console.log('获取视频模型列表...');
    const modelsRes = await axios.get('https://ai.xingyuncl.com/api/video/models', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const models = modelsRes.data.data;
    console.log(`✓ 获取到 ${models.length} 个模型\n`);
    
    // 3. 显示每个模型的状态
    models.forEach(model => {
      console.log(`模型: ${model.display_name}`);
      console.log(`  - ID: ${model.id}`);
      console.log(`  - 标识: ${model.name}`);
      console.log(`  - 提供商: ${model.provider}`);
      console.log(`  - 是否激活: ${model.is_active ? '是' : '否'}`);
      console.log(`  - API密钥状态: ${model.has_api_key ? '✓ 已配置' : '✗ 未配置'}`);
      console.log('');
    });
    
    // 4. 测试获取历史记录
    console.log('测试获取历史记录...');
    try {
      const historyRes = await axios.get('https://ai.xingyuncl.com/api/video/history', {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { page: 1, limit: 5 }
      });
      console.log('✓ 历史记录查询成功');
      console.log(`  总记录数: ${historyRes.data.data.pagination.total}`);
    } catch (err) {
      console.log('✗ 历史记录查询失败:', err.response?.data?.message || err.message);
    }
    
  } catch (error) {
    console.error('测试失败:', error.response?.data || error.message);
  }
}

test();
