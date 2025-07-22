const http = require('http');
const https = require('https');

// 这里需要一个有效的token，从浏览器控制台获取
const token = 'Bearer YOUR_TOKEN_HERE'; // 需要替换为实际的token

const data = JSON.stringify({
  username: 'superadmin',
  phone: '18210711618'
});

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/auth/profile',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': token
  }
};

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);
  console.log(`响应头:`, res.headers);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('响应体:', responseData);
    try {
      const parsed = JSON.parse(responseData);
      console.log('解析后的响应:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('无法解析JSON响应');
    }
  });
});

req.on('error', (error) => {
  console.error('请求错误:', error);
});

req.write(data);
req.end();
