/**
 * SSO集成测试
 * 使用系统现有的JWT服务测试SSO功能
 */

const JWTService = require('./src/services/jwtService');

// 模拟用户数据
const testUser = {
  id: 1,
  uuid: 'test-uuid-' + Date.now(),
  username: 'admin',
  email: 'admin@example.com',
  display_name: '管理员',
  role: 'super_admin',
  group_id: 1,
  group_name: '默认组'
};

// 模拟模块配置
const authConfig = {
  secret: 'shared-secret-key-2025',
  algorithm: 'HS256',
  expiresIn: 300,
  tokenMethod: 'query',
  tokenField: 'token',
  ssoEndpoint: '/sso/login',
  payload: {
    includes: ['uuid', 'username', 'email', 'sub', 'name']
  }
};

console.log('========================================');
console.log('SSO集成测试');
console.log('========================================\n');

console.log('测试用户信息:');
console.log(JSON.stringify(testUser, null, 2));

console.log('\n生成JWT Token...');
try {
  // 使用系统的JWT服务生成Token
  const token = JWTService.generateModuleToken(testUser, authConfig);
  
  console.log('\n✅ Token生成成功！');
  console.log('Token:', token);
  console.log('Token长度:', token.length, '字符');
  
  // 验证Token
  console.log('\n验证Token...');
  const decoded = JWTService.verifyToken(token, authConfig.secret);
  console.log('✅ Token验证成功！');
  console.log('解码内容:', JSON.stringify(decoded, null, 2));
  
  // 构建SSO URL
  const moduleUrl = 'https://academy.nebulink.com.cn';
  const authInfo = JWTService.buildAuthenticatedUrl(moduleUrl, token, authConfig);
  
  console.log('\n构建的SSO URL:');
  console.log(authInfo.url);
  
  console.log('\n========================================');
  console.log('测试总结');
  console.log('========================================');
  console.log('1. ✅ Token生成成功');
  console.log('2. ✅ Token包含uuid:', decoded.uuid);
  console.log('3. ✅ SSO URL已构建');
  console.log('\n下一步:');
  console.log('1. 复制上面的URL在浏览器中测试');
  console.log('2. 或者配置实际的模块进行测试');
  console.log('3. 确保对方系统使用相同的密钥');
  
} catch (error) {
  console.error('❌ 测试失败:', error.message);
  console.error(error.stack);
}

console.log('\n========================================');
