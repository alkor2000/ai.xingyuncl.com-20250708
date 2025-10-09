/**
 * Sora2 API 直接测试脚本
 * 测试 sora-2 和 sora-2-pro 模型
 */

const axios = require('axios');

// ========== 配置区域 ==========
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b'; // 新的API密钥
const BASE_URL = 'https://goapi.gptnb.ai';

// ========== 测试函数 ==========

/**
 * 测试文本生成视频 (sora-2)
 */
async function testSora2Basic() {
  console.log('\n========== 测试 sora-2 基础版 ==========');
  
  try {
    const response = await axios.post(
      `${BASE_URL}/sora2/v1/create`,
      {
        model: 'sora-2',
        orientation: 'landscape',
        prompt: 'A beautiful sunset over the ocean with waves'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 30000
      }
    );
    
    console.log('✅ sora-2 提交成功！');
    console.log('任务ID:', response.data.id);
    console.log('状态:', response.data.status);
    console.log('完整响应:', JSON.stringify(response.data, null, 2));
    
    return { success: true, taskId: response.data.id };
  } catch (error) {
    console.error('❌ sora-2 提交失败:');
    console.error('状态码:', error.response?.status);
    console.error('错误信息:', JSON.stringify(error.response?.data, null, 2));
    console.error('完整错误:', error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}

/**
 * 测试文本生成视频 (sora-2-pro)
 */
async function testSora2Pro() {
  console.log('\n========== 测试 sora-2-pro 专业版 ==========');
  
  try {
    const response = await axios.post(
      `${BASE_URL}/sora2/v1/create`,
      {
        model: 'sora-2-pro',
        orientation: 'landscape',
        prompt: 'A cinematic shot of a futuristic city at night'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 30000
      }
    );
    
    console.log('✅ sora-2-pro 提交成功！');
    console.log('任务ID:', response.data.id);
    console.log('状态:', response.data.status);
    console.log('完整响应:', JSON.stringify(response.data, null, 2));
    
    return { success: true, taskId: response.data.id };
  } catch (error) {
    console.error('❌ sora-2-pro 提交失败:');
    console.error('状态码:', error.response?.status);
    console.error('错误信息:', JSON.stringify(error.response?.data, null, 2));
    console.error('完整错误:', error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}

/**
 * 查询任务状态
 */
async function queryTask(taskId) {
  console.log(`\n========== 查询任务状态: ${taskId} ==========`);
  
  try {
    const encodedTaskId = encodeURIComponent(taskId);
    const response = await axios.get(
      `${BASE_URL}/sora2/v1/query?id=${encodedTaskId}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 10000
      }
    );
    
    console.log('✅ 查询成功！');
    console.log('状态:', response.data.status);
    console.log('完整响应:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.error('❌ 查询失败:');
    console.error('状态码:', error.response?.status);
    console.error('错误信息:', JSON.stringify(error.response?.data, null, 2));
    return null;
  }
}

// ========== 主函数 ==========
async function main() {
  console.log('🚀 开始测试 Sora2 API...');
  console.log('API密钥:', API_KEY.substring(0, 15) + '...' + API_KEY.substring(API_KEY.length - 5));
  console.log('端点:', BASE_URL);
  
  const results = {
    'sora-2': null,
    'sora-2-pro': null
  };
  
  // 测试 sora-2
  results['sora-2'] = await testSora2Basic();
  
  if (results['sora-2'].success) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await queryTask(results['sora-2'].taskId);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('等待3秒后测试 sora-2-pro...');
  console.log('='.repeat(60));
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 测试 sora-2-pro
  results['sora-2-pro'] = await testSora2Pro();
  
  if (results['sora-2-pro'].success) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await queryTask(results['sora-2-pro'].taskId);
  }
  
  // 输出总结
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果总结');
  console.log('='.repeat(60));
  console.log('sora-2 基础版:', results['sora-2'].success ? '✅ 支持' : '❌ 不支持');
  console.log('sora-2-pro 专业版:', results['sora-2-pro'].success ? '✅ 支持' : '❌ 不支持');
  console.log('='.repeat(60));
  
  if (results['sora-2'].success && results['sora-2-pro'].success) {
    console.log('\n🎉 两个模型都支持！可以同时添加到系统中！');
  } else if (results['sora-2'].success) {
    console.log('\n⚠️  只支持 sora-2 基础版，sora-2-pro 可能需要额外开通');
  } else if (results['sora-2-pro'].success) {
    console.log('\n⚠️  只支持 sora-2-pro 专业版');
  } else {
    console.log('\n❌ 两个模型都不支持，请检查API密钥或联系服务商');
  }
  
  console.log('');
}

// 运行测试
main().catch(err => {
  console.error('测试过程出错:', err);
  process.exit(1);
});
