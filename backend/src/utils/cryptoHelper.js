/**
 * 加密解密工具模块
 * 
 * 统一管理AES加密/解密操作，供ImageModel/VideoModel/Module等模型复用。
 * 
 * 安全策略：
 * - 新数据使用AES-256-GCM（带认证标签的加密模式，符合SonarQube S5542规则）
 * - 旧数据兼容AES-256-CBC解密（向后兼容已存储的加密数据）
 * - 密钥派生使用scryptSync，盐值从环境变量读取
 * 
 * 加密数据格式（JSON字符串）：
 * GCM模式: { encrypted: true, algorithm: 'aes-256-gcm', data: hex, iv: hex, tag: hex }
 * CBC模式（旧）: { encrypted: true, data: hex, iv: hex }
 */

const crypto = require('crypto');
const logger = require('./logger');

/**
 * 获取加密密钥
 * 使用scryptSync从JWT密钥派生32字节AES密钥
 * 
 * @returns {Buffer} 32字节密钥
 */
function _getDerivedKey() {
  const secret = process.env.JWT_ACCESS_SECRET || 'default-encryption-key';
  return crypto.scryptSync(secret, 'salt', 32);
}

/**
 * 使用AES-256-GCM加密字符串
 * GCM模式提供认证加密，防止密文篡改（符合SonarQube S5542安全要求）
 * 
 * @param {string} plaintext - 待加密的明文字符串
 * @returns {string|null} 加密后的JSON字符串，输入为空返回null
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  try {
    const key = _getDerivedKey();
    // GCM模式推荐12字节IV（NIST SP 800-38D标准）
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // GCM模式的认证标签，用于解密时验证密文完整性
    const tag = cipher.getAuthTag();

    return JSON.stringify({
      encrypted: true,
      algorithm: 'aes-256-gcm',
      data: encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    });
  } catch (error) {
    logger.error('加密失败:', error);
    throw error;
  }
}

/**
 * 解密加密数据（自动兼容GCM和CBC两种模式）
 * 
 * 解密策略：
 * 1. 如果数据包含algorithm='aes-256-gcm'字段，使用GCM解密
 * 2. 否则回退到CBC解密（兼容旧数据）
 * 3. 如果数据未加密（没有encrypted标记），直接返回原值
 * 
 * @param {string|object} encryptedData - 加密的JSON字符串或对象
 * @returns {string|null} 解密后的明文，失败返回null
 */
function decrypt(encryptedData) {
  if (!encryptedData) return null;

  try {
    const data = typeof encryptedData === 'string'
      ? JSON.parse(encryptedData)
      : encryptedData;

    // 未加密的数据直接返回原值
    if (!data.encrypted) return encryptedData;

    const key = _getDerivedKey();
    const iv = Buffer.from(data.iv, 'hex');

    // 根据algorithm字段判断使用哪种解密模式
    if (data.algorithm === 'aes-256-gcm' && data.tag) {
      // GCM模式解密（新数据）
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
      let decrypted = decipher.update(data.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } else {
      // CBC模式解密（旧数据兼容）
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(data.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
  } catch (error) {
    logger.error('解密失败:', error);
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt
};
