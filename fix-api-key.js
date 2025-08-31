const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function fixApiKey() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    console.log('检查并修复API密钥...\n');
    
    // 你的实际API密钥
    const actualApiKey = 'ark-zcRnzBieBSo8x0RNfJBqkANhCb9ijFq3FdOl4VQVzIRqDWRxkLp';
    
    // 使用相同的加密方法
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(
      'your-super-secret-key-2025', // 使用实际的JWT_ACCESS_SECRET
      'salt',
      32
    );
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(actualApiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const encryptedData = JSON.stringify({
      encrypted: true,
      data: encrypted,
      iv: iv.toString('hex')
    });
    
    // 更新数据库
    const [result] = await connection.execute(
      'UPDATE video_models SET api_key = ? WHERE id = 1',
      [encryptedData]
    );
    
    console.log('API密钥已更新');
    
    // 验证解密
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    console.log('解密验证:', decrypted === actualApiKey ? '✓ 成功' : '✗ 失败');
    console.log('API密钥前10位:', decrypted.substring(0, 10) + '...');
    
  } catch (error) {
    console.error('错误:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

fixApiKey();
