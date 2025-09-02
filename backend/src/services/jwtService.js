/**
 * JWT服务 - 用于生成模块认证的JWT Token
 * 支持SSO单点登录，包含uuid等用户信息
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
      
      // 构建payload - 基础字段
      const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (expiresIn || 3600)
      };
      
      // 根据配置添加用户信息
      if (payloadConfig && payloadConfig.includes) {
        // 标准JWT字段
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
        
        // SSO扩展字段 - 重要：添加uuid支持
        if (payloadConfig.includes.includes('uuid')) {
          payload.uuid = user.uuid;
        }
        if (payloadConfig.includes.includes('user_id')) {
          payload.user_id = user.id;
        }
        if (payloadConfig.includes.includes('username')) {
          payload.username = user.username;
        }
        if (payloadConfig.includes.includes('display_name')) {
          payload.display_name = user.display_name || user.username;
        }
        if (payloadConfig.includes.includes('avatar')) {
          payload.avatar = user.avatar;
        }
        if (payloadConfig.includes.includes('phone')) {
          payload.phone = user.phone;
        }
        if (payloadConfig.includes.includes('group_id')) {
          payload.group_id = user.group_id;
        }
        if (payloadConfig.includes.includes('group_name')) {
          payload.group_name = user.group_name || '默认组';
        }
      }
      
      // 如果配置了自定义字段映射
      if (payloadConfig && payloadConfig.customFields) {
        Object.keys(payloadConfig.customFields).forEach(targetField => {
          const sourceField = payloadConfig.customFields[targetField];
          if (user[sourceField] !== undefined) {
            payload[targetField] = user[sourceField];
          }
        });
      }
      
      // 生成token - 不使用expiresIn选项，因为已经在payload中设置了exp
      const token = jwt.sign(payload, secret, {
        algorithm: algorithm || 'HS256'
      });
      
      logger.info('生成模块JWT Token成功', { 
        userId: user.id,
        uuid: user.uuid,
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
    const { tokenMethod, tokenField, ssoEndpoint } = authConfig;
    
    // 如果配置了SSO端点，使用SSO端点而不是模块URL
    let baseUrl = moduleUrl;
    if (ssoEndpoint) {
      // 支持相对路径和绝对路径
      if (ssoEndpoint.startsWith('http')) {
        baseUrl = ssoEndpoint;
      } else {
        // 相对路径，拼接到模块URL
        const urlParts = new URL(moduleUrl);
        baseUrl = `${urlParts.protocol}//${urlParts.host}${ssoEndpoint}`;
      }
    }
    
    let url = baseUrl;
    let headers = {};
    let formData = null;
    
    switch (tokenMethod) {
      case 'query':
        // URL参数方式 - 最常用的SSO方式
        const separator = baseUrl.includes('?') ? '&' : '?';
        url = `${baseUrl}${separator}${tokenField || 'token'}=${encodeURIComponent(token)}`;
        
        // 如果配置了回调URL，添加到参数中
        if (authConfig.callbackUrl) {
          url += `&callback=${encodeURIComponent(authConfig.callbackUrl)}`;
        }
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
        if (authConfig.callbackUrl) {
          formData.callback = authConfig.callbackUrl;
        }
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
  
  /**
   * 生成SSO验证接口的响应
   * 供外部系统调用验证token并获取用户信息
   * @param {string} token - JWT token
   * @param {string} secret - 密钥
   * @returns {Object} 用户信息
   */
  static validateSSOToken(token, secret) {
    try {
      const decoded = jwt.verify(token, secret);
      
      // 检查token是否过期
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        throw new Error('Token已过期');
      }
      
      // 返回标准化的用户信息
      return {
        success: true,
        user: {
          uuid: decoded.uuid,
          user_id: decoded.user_id || decoded.sub,
          username: decoded.username || decoded.name,
          email: decoded.email,
          display_name: decoded.display_name,
          avatar: decoded.avatar,
          phone: decoded.phone,
          role: decoded.role,
          group_id: decoded.group_id,
          group_name: decoded.group_name
        },
        exp: decoded.exp,
        iat: decoded.iat
      };
    } catch (error) {
      logger.error('SSO Token验证失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = JWTService;
