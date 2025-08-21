/**
 * 检查API账户状态
 */

const axios = require('axios');

const API_BASE_URL = 'https://goapi.gptnb.ai';
const API_KEY = 'sk-siWVK6Ljr9fw4gBD2e36410655474973A3457dE02211Ee0b';

async function checkAccount() {
  console.log('检查API账户信息...\n');
  
  // 尝试不同的端点
  const endpoints = [
    '/account',
    '/user/info', 
    '/api/user',
    '/mj/account'
  ];
  
  for (const endpoint of endpoints) {
    console.log(`尝试: ${endpoint}`);
    try {
      const response = await axios.get(
        `${API_BASE_URL}${endpoint}`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`
          },
          timeout: 5000
        }
      );
      
      console.log('✅ 成功:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('');
    } catch (error) {
      if (error.response) {
        console.log(`❌ HTTP ${error.response.status}`);
      } else {
        console.log(`❌ ${error.message}`);
      }
    }
  }
}

checkAccount();
