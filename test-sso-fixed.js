/**
 * SSO接口测试脚本 - 修复版本
 */

const crypto = require('crypto');
const https = require('https');

// 配置参数
const username = `sso_test_user_${Date.now()}`;
const timestamp = Math.floor(Date.now() / 1000); // 正确的秒级时间戳
const sharedSecret = '92c5a700302fded78bf02328d0cb8013';

// 生成签名
const signatureString = username + timestamp + sharedSecret;
const signature = crypto
  .createHash('sha256')
  .update(signatureString)
  .digest('hex');

const data = JSON.stringify({
  username: username,
  timestamp: timestamp,
  signature: signature
});

console.log('\n========== SSO测试开始 ==========');
console.log('测试URL: https://ai.xingyuncl.com/api/auth/sso');
console.log('用户名:', username);
console.log('时间戳:', timestamp);
console.log('当前时间:', new Date(timestamp * 1000).toISOString());
console.log('签名源串:', signatureString);
console.log('签名:', signature);
console.log('请求数据:', JSON.parse(data));
console.log('================================\n');

const options = {
  hostname: 'ai.xingyuncl.com',
  path: '/api/auth/sso',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  console.log('HTTP状态码:', res.statusCode);
  console.log('响应头:', res.headers);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('\n响应内容:');
    try {
      const result = JSON.parse(responseData);
      console.log(JSON.stringify(result, null, 2));
      
      if (result.success) {
        console.log('\n✅ SSO测试成功！');
        
        if (result.data) {
          console.log('\n返回数据:');
          console.log('- 用户ID:', result.data.userId || 'N/A');
          console.log('- 用户名:', result.data.username || 'N/A');
          console.log('- Email:', result.data.email || 'N/A');
          console.log('- 角色:', result.data.role || 'N/A');
          console.log('- 组ID:', result.data.groupId || 'N/A');
          console.log('- 积分:', result.data.credits || 'N/A');
          
          if (result.data.redirectUrl) {
            console.log('\n🔗 登录链接（复制到浏览器打开）:');
            console.log('\x1b[36m%s\x1b[0m', result.data.redirectUrl);
            console.log('\n这个链接包含了认证令牌，打开后会自动登录到系统。');
          }
        }
      } else {
        console.log('\n❌ SSO测试失败');
        console.log('错误信息:', result.message || '未知错误');
        
        if (result.data && result.data.errors) {
          console.log('详细错误:', result.data.errors);
        }
        
        console.log('\n调试信息:');
        console.log('- 确保SSO功能已启用');
        console.log('- 确保密钥正确');
        console.log('- 确保目标组ID已设置');
        console.log('- 确保时间戳在有效期内（5分钟）');
      }
    } catch (e) {
      console.log('原始响应:', responseData);
      console.log('解析失败:', e.message);
    }
    
    console.log('\n========== 测试结束 ==========');
  });
});

req.on('error', (e) => {
  console.error('请求失败:', e.message);
});

req.write(data);
req.end();
