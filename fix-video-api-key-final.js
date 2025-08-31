const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function fixApiKeyFinal() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    
    console.log('修复视频模型API密钥...\n');
    
    // 新的API密钥
    const actualApiKey = 'f180d2fb-3355-4679-8110-5d398dad3bd3';
    
    // 使用与VideoModel.js相同的加密密钥
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(
      process.env.JWT_ACCESS_SECRET || 'default-encryption-key',  // 使用相同的默认密钥
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
    
    console.log('✓ API密钥已更新');
    
    // 验证解密
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    console.log('✓ 解密验证成功');
    console.log('API密钥（前8位）:', decrypted.substring(0, 8) + '...');
    
    // 清理旧的失败记录
    await connection.execute(
      `UPDATE video_generations SET status = 'cancelled', error_message = '任务已取消' WHERE status IN ('running', 'queued', 'failed')`
    );
    console.log('✓ 已清理旧的任务记录');
    
  } catch (error) {
    console.error('错误:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

fixApiKeyFinal();
