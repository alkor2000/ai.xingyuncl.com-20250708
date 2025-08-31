const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function updateApiKey() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    // 新的API密钥
    const newApiKey = 'f180d2fb-3355-4679-8110-5d398dad3bd3';
    
    // 加密
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('your-super-secret-key-2025', 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(newApiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const encryptedData = JSON.stringify({
      encrypted: true,
      data: encrypted,
      iv: iv.toString('hex')
    });
    
    // 更新数据库
    await connection.execute(
      'UPDATE video_models SET api_key = ? WHERE id = 1',
      [encryptedData]
    );
    
    console.log('✓ API密钥已更新为新的UUID格式密钥');
    
  } catch (error) {
    console.error('错误:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

updateApiKey();
