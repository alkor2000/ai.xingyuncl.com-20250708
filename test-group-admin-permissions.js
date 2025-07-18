/**
 * 测试组管理员权限功能
 */

const axios = require('axios');

const API_BASE = 'http://localhost:4000/api';

// 测试账号
const SUPER_ADMIN = {
  email: 'admin@example.com',  // 请替换为实际的超级管理员账号
  password: 'your_password'
};

const GROUP_ADMIN = {
  email: 'groupadmin@example.com',  // 请替换为实际的组管理员账号
  password: 'your_password'
};

async function login(credentials) {
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, credentials);
    return response.data.data;
  } catch (error) {
    console.error('登录失败:', error.response?.data || error.message);
    return null;
  }
}

async function testGetAIModels(token, userType) {
  console.log(`\n=== 测试 ${userType} 获取AI模型列表 ===`);
  try {
    const response = await axios.get(`${API_BASE}/admin/models`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const models = response.data.data;
    console.log(`获取到 ${models.length} 个模型`);
    
    if (models.length > 0) {
      const firstModel = models[0];
      console.log('第一个模型信息:');
      console.log('- ID:', firstModel.id);
      console.log('- 名称:', firstModel.name);
      console.log('- 显示名称:', firstModel.display_name);
      console.log('- API密钥:', firstModel.api_key ? '已显示' : '已隐藏');
      console.log('- API端点:', firstModel.api_endpoint ? '已显示' : '已隐藏');
    }
  } catch (error) {
    console.error('获取失败:', error.response?.data || error.message);
  }
}

async function testUpdateAIModel(token, userType) {
  console.log(`\n=== 测试 ${userType} 更新AI模型 ===`);
  try {
    // 先获取模型列表
    const listResponse = await axios.get(`${API_BASE}/admin/models`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (listResponse.data.data.length === 0) {
      console.log('没有可更新的模型');
      return;
    }
    
    const modelId = listResponse.data.data[0].id;
    
    // 尝试更新
    const response = await axios.put(`${API_BASE}/admin/models/${modelId}`, {
      credits_per_chat: 20
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('更新成功');
  } catch (error) {
    console.log('更新失败（预期行为）:', error.response?.data?.message || error.message);
  }
}

async function testGetSystemSettings(token, userType) {
  console.log(`\n=== 测试 ${userType} 获取系统设置 ===`);
  try {
    const response = await axios.get(`${API_BASE}/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const settings = response.data.data;
    console.log('获取成功:');
    console.log('- 只读模式:', settings._readOnly ? '是' : '否');
    console.log('- 消息:', settings._message || '无');
  } catch (error) {
    console.error('获取失败:', error.response?.data || error.message);
  }
}

async function testUpdateSystemSettings(token, userType) {
  console.log(`\n=== 测试 ${userType} 更新系统设置 ===`);
  try {
    const response = await axios.put(`${API_BASE}/admin/settings`, {
      site: { name: 'Test Platform' }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('更新成功');
  } catch (error) {
    console.log('更新失败（预期行为）:', error.response?.data?.message || error.message);
  }
}

async function runTests() {
  console.log('开始测试组管理员权限功能...\n');
  
  // 1. 测试超级管理员
  console.log('### 超级管理员测试 ###');
  const superAdminAuth = await login(SUPER_ADMIN);
  if (superAdminAuth) {
    await testGetAIModels(superAdminAuth.tokens.accessToken, '超级管理员');
    await testUpdateAIModel(superAdminAuth.tokens.accessToken, '超级管理员');
    await testGetSystemSettings(superAdminAuth.tokens.accessToken, '超级管理员');
    await testUpdateSystemSettings(superAdminAuth.tokens.accessToken, '超级管理员');
  }
  
  // 2. 测试组管理员
  console.log('\n\n### 组管理员测试 ###');
  const groupAdminAuth = await login(GROUP_ADMIN);
  if (groupAdminAuth) {
    await testGetAIModels(groupAdminAuth.tokens.accessToken, '组管理员');
    await testUpdateAIModel(groupAdminAuth.tokens.accessToken, '组管理员');
    await testGetSystemSettings(groupAdminAuth.tokens.accessToken, '组管理员');
    await testUpdateSystemSettings(groupAdminAuth.tokens.accessToken, '组管理员');
  }
  
  console.log('\n\n测试完成！');
}

runTests();
