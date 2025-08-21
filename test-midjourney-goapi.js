/**
 * Midjourney GoAPI 测试脚本
 */

const axios = require('axios');
const colors = require('colors');

// API配置
const API_BASE_URL = 'https://goapi.gptnb.ai';
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b';

console.log('========================================'.cyan);
console.log('Midjourney GoAPI 测试'.yellow.bold);
console.log('========================================'.cyan);
console.log(`API Base URL: ${API_BASE_URL}`.gray);
console.log(`API Key: ${API_KEY.substring(0, 10)}...${API_KEY.substring(API_KEY.length - 5)}`.gray);
console.log('');

// 测试结果收集
const testResults = [];

// 辅助函数：记录测试结果
function recordTest(name, success, details = '') {
  testResults.push({ name, success, details });
  if (success) {
    console.log(`✅ ${name}`.green);
  } else {
    console.log(`❌ ${name}`.red);
  }
  if (details) {
    console.log(`   ${details}`.gray);
  }
}

// 主测试函数
async function runTests() {
  console.log('1. 测试API连接性'.blue.bold);
  console.log('----------------------------------------'.gray);
  
  // 测试1: 基础连接
  try {
    const startTime = Date.now();
    const response = await axios.get(`${API_BASE_URL}/health`, {
      timeout: 10000
    });
    const responseTime = Date.now() - startTime;
    recordTest('基础连接测试', true, `响应时间: ${responseTime}ms`);
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      recordTest('基础连接测试', false, 'DNS解析失败');
    } else if (error.response) {
      // 即使是404也表示服务器可达
      recordTest('基础连接测试', true, `HTTP ${error.response.status} - 服务器可达`);
    } else {
      recordTest('基础连接测试', false, error.message);
    }
  }
  
  console.log('');
  console.log('2. 测试Imagine接口（文生图）'.blue.bold);
  console.log('----------------------------------------'.gray);
  
  let taskId = null;
  
  try {
    const response = await axios.post(
      `${API_BASE_URL}/mj/submit/imagine`,
      {
        prompt: 'a cute cat, simple test --v 6'
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    if (response.data.code === 1) {
      taskId = response.data.result;
      recordTest('Imagine提交', true, `任务ID: ${taskId}, 描述: ${response.data.description}`);
    } else {
      recordTest('Imagine提交', false, `错误码: ${response.data.code}, 描述: ${response.data.description}`);
    }
  } catch (error) {
    if (error.response) {
      recordTest('Imagine提交', false, `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      
      // 分析具体错误
      if (error.response.status === 401) {
        console.log('   ⚠️  认证失败，API Key可能无效'.yellow);
      } else if (error.response.status === 403) {
        console.log('   ⚠️  权限不足，可能需要充值或升级'.yellow);
      } else if (error.response.status === 429) {
        console.log('   ⚠️  请求频率超限'.yellow);
      }
    } else {
      recordTest('Imagine提交', false, error.message);
    }
  }
  
  console.log('');
  console.log('3. 测试任务查询接口'.blue.bold);
  console.log('----------------------------------------'.gray);
  
  // 使用一个测试任务ID
  const testTaskId = taskId || '1320098173412546';
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/mj/task/${testTaskId}/fetch`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 10000
      }
    );
    
    if (response.data) {
      recordTest('任务查询', true, `状态: ${response.data.status || 'N/A'}`);
      console.log(`   任务详情:`.gray);
      console.log(`   - ID: ${response.data.id}`.gray);
      console.log(`   - 状态: ${response.data.status}`.gray);
      console.log(`   - 动作: ${response.data.action}`.gray);
      console.log(`   - 进度: ${response.data.progress || 'N/A'}`.gray);
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      recordTest('任务查询', true, '接口正常（任务不存在）');
    } else if (error.response) {
      recordTest('任务查询', false, `HTTP ${error.response.status}`);
    } else {
      recordTest('任务查询', false, error.message);
    }
  }
  
  console.log('');
  console.log('4. 测试Change接口（U/V操作）'.blue.bold);
  console.log('----------------------------------------'.gray);
  
  try {
    // 测试simple-change接口
    const response = await axios.post(
      `${API_BASE_URL}/mj/submit/simple-change`,
      {
        content: `${testTaskId} U1`
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (response.data.code === 1 || response.data.code === 21) {
      recordTest('Change接口', true, response.data.description);
    } else {
      recordTest('Change接口', false, `错误码: ${response.data.code}`);
    }
  } catch (error) {
    if (error.response) {
      // 某些错误码可能表示接口正常但任务无效
      if (error.response.status === 400) {
        recordTest('Change接口', true, '接口正常（任务无效）');
      } else {
        recordTest('Change接口', false, `HTTP ${error.response.status}`);
      }
    } else {
      recordTest('Change接口', false, error.message);
    }
  }
  
  console.log('');
  console.log('5. 测试不同模式的端点'.blue.bold);
  console.log('----------------------------------------'.gray);
  
  // 测试不同模式
  const modes = [
    { name: 'Fast模式', path: '/mj' },
    { name: 'Turbo模式', path: '/mj-turbo' },
    { name: 'Relax模式', path: '/mj-relax' }
  ];
  
  for (const mode of modes) {
    try {
      const response = await axios.post(
        `${API_BASE_URL}${mode.path}/submit/imagine`,
        {
          prompt: 'test'
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      if (response.data.code === 1 || response.data.code === 21 || response.data.code === 22) {
        recordTest(mode.name, true, '端点可用');
      } else {
        recordTest(mode.name, false, `错误码: ${response.data.code}`);
      }
    } catch (error) {
      if (error.response && error.response.status === 401) {
        recordTest(mode.name, false, '认证失败');
      } else if (error.response && error.response.status === 403) {
        recordTest(mode.name, false, '权限不足（可能未开通此模式）');
      } else if (error.response) {
        recordTest(mode.name, false, `HTTP ${error.response.status}`);
      } else {
        recordTest(mode.name, false, '连接失败');
      }
    }
  }
  
  console.log('');
  console.log('========================================'.cyan);
  console.log('测试结果汇总'.yellow.bold);
  console.log('========================================'.cyan);
  
  const successCount = testResults.filter(t => t.success).length;
  const failCount = testResults.filter(t => !t.success).length;
  
  testResults.forEach(test => {
    const icon = test.success ? '✅' : '❌';
    const color = test.success ? 'green' : 'red';
    console.log(`${icon} ${test.name}`[color]);
  });
  
  console.log('');
  console.log(`成功: ${successCount}/${testResults.length}`.green);
  console.log(`失败: ${failCount}/${testResults.length}`.red);
  
  console.log('');
  console.log('========================================'.cyan);
  console.log('诊断建议'.yellow.bold);
  console.log('========================================'.cyan);
  
  // 根据测试结果给出建议
  const imagineTest = testResults.find(t => t.name === 'Imagine提交');
  const queryTest = testResults.find(t => t.name === '任务查询');
  const changeTest = testResults.find(t => t.name === 'Change接口');
  
  if (imagineTest && !imagineTest.success) {
    console.log('⚠️  Imagine接口失败可能的原因：'.yellow);
    console.log('   1. API Key无效或过期');
    console.log('   2. 账户余额不足');
    console.log('   3. 服务商API故障');
    console.log('   建议：检查API Key和账户状态');
  }
  
  if (changeTest && !changeTest.success) {
    console.log('⚠️  Change接口失败可能的原因：'.yellow);
    console.log('   1. 任务ID无效');
    console.log('   2. 任务未完成不能执行操作');
    console.log('   3. API权限问题');
  }
  
  if (successCount === testResults.length) {
    console.log('✅ 所有测试通过！API工作正常'.green.bold);
  } else if (successCount > 0) {
    console.log('⚠️  部分功能正常，请检查失败的接口'.yellow);
  } else {
    console.log('❌ 所有测试失败，请检查API配置和网络连接'.red.bold);
  }
  
  // 配置建议
  console.log('');
  console.log('配置建议：'.cyan.bold);
  console.log('在 /var/www/ai-platform/backend/.env 中设置：');
  console.log(`MIDJOURNEY_API_URL=${API_BASE_URL}/mj`.gray);
  console.log(`MIDJOURNEY_API_KEY=${API_KEY}`.gray);
}

// 运行测试
runTests().catch(error => {
  console.error('测试过程中发生错误：'.red, error);
});
