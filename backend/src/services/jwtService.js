/**
 * JWT服务 - 用于生成模块认证的JWT Token
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class JWTService {
  /**
   * 为模块生成JWT Token
   * @param {Object} user - 用户信息
   * @param {Object} authConfig - 认证配置
   * @returns {string} JWT token
   */
  static generateModuleToken(user, authConfig) {
    try {
      const { secret, algorithm, expiresIn, payload: payloadConfig } = authConfig;
      
      // 构建payload
      const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (expiresIn || 3600)
      };
      
      // 根据配置添加用户信息
      if (payloadConfig && payloadConfig.includes) {
        if (payloadConfig.includes.includes('sub')) {
          payload.sub = user.id.toString();
        }
        if (payloadConfig.includes.includes('name')) {
          payload.name = user.username;
        }
        if (payloadConfig.includes.includes('email')) {
          payload.email = user.email;
        }
        if (payloadConfig.includes.includes('role')) {
          payload.role = user.role;
        }
      }
      
      // 添加额外的用户信息
      payload.group_id = user.group_id;
      payload.group_name = user.group_name || '默认组';
      
      // 生成token - 不使用expiresIn选项，因为已经在payload中设置了exp
      const token = jwt.sign(payload, secret, {
        algorithm: algorithm || 'HS256'
      });
      
      logger.info('生成模块JWT Token成功', { 
        userId: user.id,
        algorithm,
        expiresIn,
        payloadFields: Object.keys(payload)
      });
      
      return token;
    } catch (error) {
      logger.error('生成模块JWT Token失败:', error);
      throw new Error('生成认证Token失败');
    }
  }
  
  /**
   * 构建带JWT认证的URL
   * @param {string} moduleUrl - 模块URL
   * @param {string} token - JWT token
   * @param {Object} authConfig - 认证配置
   * @returns {Object} 包含url和headers的对象
   */
  static buildAuthenticatedUrl(moduleUrl, token, authConfig) {
    const { tokenMethod, tokenField } = authConfig;
    let url = moduleUrl;
    let headers = {};
    let formData = null;
    
    switch (tokenMethod) {
      case 'query':
        // URL参数方式
        const separator = moduleUrl.includes('?') ? '&' : '?';
        url = `${moduleUrl}${separator}${tokenField || 'token'}=${encodeURIComponent(token)}`;
        break;
        
      case 'header':
        // Header方式
        const headerName = tokenField || 'Authorization';
        headers[headerName] = headerName === 'Authorization' ? `Bearer ${token}` : token;
        break;
        
      case 'cookie':
        // Cookie方式 - 需要前端特殊处理
        headers['Set-Cookie'] = `${tokenField || 'token'}=${token}; Path=/; HttpOnly; SameSite=Lax`;
        break;
        
      case 'post':
        // POST方式 - 需要构建表单
        formData = {
          [tokenField || 'token']: token
        };
        break;
    }
    
    return {
      url,
      headers,
      formData,
      method: tokenMethod === 'post' ? 'POST' : 'GET'
    };
  }
  
  /**
   * 验证JWT Token（用于测试）
   * @param {string} token - JWT token
   * @param {string} secret - 密钥
   * @returns {Object} 解码后的payload
   */
  static verifyToken(token, secret) {
    try {
      const decoded = jwt.verify(token, secret);
      return decoded;
    } catch (error) {
      logger.error('验证JWT Token失败:', error);
      throw new Error('Token验证失败');
    }
  }
}

module.exports = JWTService;
