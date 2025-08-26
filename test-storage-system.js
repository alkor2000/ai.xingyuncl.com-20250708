/**
 * 文件管理系统测试脚本
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://ai.xingyuncl.com/api';
let authToken = '';
let testFolderId = null;

// 测试配置 - 使用正确的参数名称
const testConfig = {
  account: 'admin',  // 改为account
  password: '123456'
};

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 1. 登录获取token
async function login() {
  try {
    log('\n========== 1. 登录测试 ==========', 'blue');
    log(`  账号: ${testConfig.account}`, 'yellow');
    
    const response = await axios.post(`${API_BASE}/auth/login`, testConfig);
    
    authToken = response.data.data.accessToken || response.data.data.token;
    log(`✓ 登录成功，获取到token`, 'green');
    log(`  Token前20位: ${authToken.substring(0, 20)}...`, 'green');
    log(`  用户角色: ${response.data.data.user.role}`, 'green');
    return true;
  } catch (error) {
    log(`✗ 登录失败: ${error.response?.data?.message || error.message}`, 'red');
    if (error.response?.data) {
      log(`  详细错误: ${JSON.stringify(error.response.data)}`, 'red');
    }
    return false;
  }
}

// 2. 创建文件夹
async function createFolder() {
  try {
    log('\n========== 2. 创建文件夹测试 ==========', 'blue');
    const response = await axios.post(
      `${API_BASE}/storage/folders`,
      {
        name: `测试文件夹_${Date.now()}`,
        parent_id: null
      },
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    testFolderId = response.data.data.id;
    log(`✓ 文件夹创建成功，ID: ${testFolderId}`, 'green');
    log(`  文件夹名: ${response.data.data.name}`, 'green');
    return true;
  } catch (error) {
    log(`✗ 创建文件夹失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 3. 获取文件夹列表
async function getFolders() {
  try {
    log('\n========== 3. 获取文件夹列表测试 ==========', 'blue');
    const response = await axios.get(
      `${API_BASE}/storage/folders`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    log(`✓ 获取文件夹列表成功`, 'green');
    log(`  文件夹数量: ${response.data.data.length}`, 'green');
    
    if (response.data.data.length > 0) {
      response.data.data.slice(0, 3).forEach(folder => {
        log(`  - ${folder.name} (ID: ${folder.id})`, 'green');
      });
      if (response.data.data.length > 3) {
        log(`  ... 还有 ${response.data.data.length - 3} 个文件夹`, 'green');
      }
    }
    return true;
  } catch (error) {
    log(`✗ 获取文件夹列表失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 4. 获取文件列表
async function getFiles() {
  try {
    log('\n========== 4. 获取文件列表测试 ==========', 'blue');
    const response = await axios.get(
      `${API_BASE}/storage/files`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    log(`✓ 获取文件列表成功`, 'green');
    log(`  文件总数: ${response.data.data.pagination.total}`, 'green');
    log(`  当前页文件数: ${response.data.data.files.length}`, 'green');
    
    if (response.data.data.files.length > 0) {
      response.data.data.files.slice(0, 3).forEach(file => {
        log(`  - ${file.original_name} (${(file.file_size/1024).toFixed(2)}KB)`, 'green');
      });
      if (response.data.data.files.length > 3) {
        log(`  ... 还有 ${response.data.data.files.length - 3} 个文件`, 'green');
      }
    }
    return true;
  } catch (error) {
    log(`✗ 获取文件列表失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 5. 获取存储统计
async function getStorageStats() {
  try {
    log('\n========== 5. 获取存储统计测试 ==========', 'blue');
    const response = await axios.get(
      `${API_BASE}/storage/stats`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    const stats = response.data.data;
    log(`✓ 获取存储统计成功`, 'green');
    log(`  存储配额: ${(stats.storage_quota/1024/1024/1024).toFixed(2)} GB`, 'green');
    log(`  已使用: ${(stats.storage_used/1024/1024).toFixed(2)} MB`, 'green');
    log(`  文件数: ${stats.file_count}`, 'green');
    log(`  文件夹数: ${stats.folder_count}`, 'green');
    return true;
  } catch (error) {
    log(`✗ 获取存储统计失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 6. 测试OSS配置获取
async function getOSSConfig() {
  try {
    log('\n========== 6. 获取OSS配置测试 ==========', 'blue');
    const response = await axios.get(
      `${API_BASE}/admin/oss/config`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    const config = response.data.data;
    log(`✓ 获取OSS配置成功`, 'green');
    log(`  启用状态: ${config.enabled ? '已启用' : '未启用'}`, 'green');
    log(`  存储类型: ${config.provider}`, 'green');
    log(`  存储区域: ${config.region || '未配置'}`, 'green');
    log(`  存储桶: ${config.bucket || '未配置'}`, 'green');
    return true;
  } catch (error) {
    log(`✗ 获取OSS配置失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 7. 获取积分配置
async function getCreditConfig() {
  try {
    log('\n========== 7. 获取积分配置测试 ==========', 'blue');
    const response = await axios.get(
      `${API_BASE}/admin/oss/credit-config`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    log(`✓ 获取积分配置成功`, 'green');
    log(`  配置数量: ${response.data.data.length}`, 'green');
    
    response.data.data.forEach(config => {
      log(`  - ${config.file_type} ${config.action_type}: ${config.credits_per_mb}积分/MB (最小${config.min_credits}, 最大${config.max_credits})`, 'green');
    });
    return true;
  } catch (error) {
    log(`✗ 获取积分配置失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 8. 创建测试文件并上传
async function uploadTestFile() {
  try {
    log('\n========== 8. 文件上传测试 ==========', 'blue');
    
    // 创建一个测试文本文件
    const testFileName = `test_${Date.now()}.txt`;
    const testFilePath = `/tmp/${testFileName}`;
    const testContent = '这是一个测试文件，用于验证文件上传功能。\n测试时间：' + new Date().toISOString();
    
    fs.writeFileSync(testFilePath, testContent);
    log(`  创建测试文件: ${testFileName}`, 'yellow');
    
    // 准备上传
    const form = new FormData();
    form.append('files', fs.createReadStream(testFilePath));
    if (testFolderId) {
      form.append('folder_id', testFolderId);
    }
    form.append('is_public', 'false');
    
    const response = await axios.post(
      `${API_BASE}/storage/files/upload`,
      form,
      {
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          ...form.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    log(`✓ 文件上传成功`, 'green');
    if (response.data.data.success && response.data.data.success.length > 0) {
      const uploadedFile = response.data.data.success[0];
      log(`  文件名: ${uploadedFile.original_name}`, 'green');
      log(`  文件大小: ${uploadedFile.file_size} bytes`, 'green');
      log(`  OSS路径: ${uploadedFile.oss_key}`, 'green');
      log(`  积分消耗: ${response.data.data.credits_used || 0}`, 'green');
    }
    
    // 清理测试文件
    fs.unlinkSync(testFilePath);
    
    return true;
  } catch (error) {
    log(`✗ 文件上传失败: ${error.response?.data?.message || error.message}`, 'red');
    if (error.response?.data) {
      log(`  详细错误: ${JSON.stringify(error.response.data)}`, 'red');
    }
    return false;
  }
}

// 9. 删除测试文件夹
async function deleteTestFolder() {
  if (!testFolderId) {
    log('\n========== 9. 删除测试文件夹 (跳过-无文件夹) ==========', 'yellow');
    return true;
  }
  
  try {
    log('\n========== 9. 删除测试文件夹 ==========', 'blue');
    await axios.delete(
      `${API_BASE}/storage/folders/${testFolderId}`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );
    
    log(`✓ 测试文件夹删除成功`, 'green');
    return true;
  } catch (error) {
    log(`✗ 删除文件夹失败: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

// 运行所有测试
async function runTests() {
  log('\n' + '='.repeat(50), 'blue');
  log('         文件管理系统功能测试', 'blue');
  log('='.repeat(50), 'blue');
  
  const tests = [
    { name: '登录', fn: login, critical: true },
    { name: '创建文件夹', fn: createFolder },
    { name: '获取文件夹列表', fn: getFolders },
    { name: '获取文件列表', fn: getFiles },
    { name: '获取存储统计', fn: getStorageStats },
    { name: '获取OSS配置', fn: getOSSConfig },
    { name: '获取积分配置', fn: getCreditConfig },
    { name: '文件上传', fn: uploadTestFile },
    { name: '删除测试文件夹', fn: deleteTestFolder }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
        // 如果是关键测试失败（如登录），停止后续测试
        if (test.critical && !result) {
          log('\n⚠️  关键测试失败，停止后续测试', 'yellow');
          failed += (tests.length - passed - failed);
          break;
        }
      }
    } catch (error) {
      failed++;
      log(`✗ ${test.name}测试异常: ${error.message}`, 'red');
    }
  }
  
  // 测试总结
  log('\n' + '='.repeat(50), 'blue');
  log('              测试结果总结', 'blue');
  log('='.repeat(50), 'blue');
  log(`✓ 通过: ${passed}`, 'green');
  log(`✗ 失败: ${failed}`, failed > 0 ? 'red' : 'green');
  log(`总计: ${tests.length} 个测试`, 'blue');
  
  if (failed === 0) {
    log('\n🎉 所有测试通过！文件管理系统运行正常', 'green');
  } else {
    log('\n⚠️  部分测试失败，请检查错误信息', 'yellow');
  }
}

// 执行测试
runTests().catch(error => {
  log(`测试执行失败: ${error.message}`, 'red');
  process.exit(1);
});
