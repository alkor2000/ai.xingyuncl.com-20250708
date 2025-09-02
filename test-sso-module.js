/**
 * SSO模块测试脚本
 * 测试JWT Token生成和跳转URL构建
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');

// 测试配置（模拟实际配置）
const testConfig = {
  // 模块配置
  moduleUrl: 'https://academy.nebulink.com.cn',
  ssoEndpoint: '/sso/login',
  
  // JWT配置
  secret: 'shared-secret-key-2025',
  algorithm: 'HS256',
  expiresIn: 300, // 5分钟
  tokenMethod: 'query',
  tokenField: 'token',
  
  // 用户数据（模拟从数据库获取）
  user: {
    id: 1,
    uuid: 'test-uuid-123456',
    username: 'testuser',
    email: 'test@example.com',
    display_name: '测试用户',
    role: 'user',
    group_id: 1,
    group_name: '默认组'
  },
  
  // 要包含的字段
  includeFields: ['uuid', 'username', 'email', 'sub', 'name']
};

console.log('====================================');
console.log('SSO模块测试');
console.log('====================================\n');

// 1. 生成JWT Token
console.log('1. 生成JWT Token');
console.log('-------------------');

const payload = {
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + testConfig.expiresIn
};

// 添加配置的字段
if (testConfig.includeFields.includes('sub')) {
  payload.sub = testConfig.user.id.toString();
}
if (testConfig.includeFields.includes('uuid')) {
  payload.uuid = testConfig.user.uuid;
}
if (testConfig.includeFields.includes('username')) {
  payload.username = testConfig.user.username;
}
if (testConfig.includeFields.includes('name')) {
  payload.name = testConfig.user.username;
}
if (testConfig.includeFields.includes('email')) {
  payload.email = testConfig.user.email;
}

console.log('Payload内容:');
console.log(JSON.stringify(payload, null, 2));

const token = jwt.sign(payload, testConfig.secret, {
  algorithm: testConfig.algorithm
});

console.log('\n生成的Token:');
console.log(token);
console.log('\nToken长度:', token.length, '字符');

// 2. 验证Token
console.log('\n2. 验证Token');
console.log('-------------------');

try {
  const decoded = jwt.verify(token, testConfig.secret, {
    algorithms: [testConfig.algorithm]
  });
  console.log('✅ Token验证成功！');
  console.log('解码后的内容:');
  console.log(JSON.stringify(decoded, null, 2));
  
  // 检查过期时间
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = decoded.exp - now;
  console.log(`\nToken有效期: ${timeLeft}秒 (${Math.floor(timeLeft/60)}分钟)`);
} catch (error) {
  console.error('❌ Token验证失败:', error.message);
}

// 3. 构建跳转URL
console.log('\n3. 构建跳转URL');
console.log('-------------------');

const ssoUrl = testConfig.moduleUrl + testConfig.ssoEndpoint;
const fullUrl = `${ssoUrl}?${testConfig.tokenField}=${encodeURIComponent(token)}`;

console.log('SSO完整URL:');
console.log(fullUrl);
console.log('\nURL长度:', fullUrl.length, '字符');

// 4. 模拟对方系统验证（可选）
console.log('\n4. 模拟对方系统验证');
console.log('-------------------');
console.log('对方系统应该:');
console.log('1) 从URL参数获取token');
console.log('2) 使用相同的密钥验证token');
console.log('3) 提取uuid:', payload.uuid);
console.log('4) 根据uuid创建或查找用户');
console.log('5) 自动登录该用户');
console.log('6) 跳转到 /dashboard（如果配置了）');

// 5. 测试建议
console.log('\n5. 测试建议');
console.log('-------------------');
console.log('你可以:');
console.log('1) 复制上面的URL在浏览器中打开');
console.log('2) 查看对方系统的响应');
console.log('3) 检查是否成功登录');
console.log('\n注意事项:');
console.log('- Token有效期只有5分钟，请尽快测试');
console.log('- 确保对方系统已配置相同的密钥');
console.log('- 检查对方系统的日志了解处理情况');

console.log('\n====================================');
console.log('测试完成！');
console.log('====================================');
