/**
 * JWT服务 - 用于生成模块认证的JWT Token
 * 
 * 职责：
 * 1. 为外部模块生成JWT认证Token（支持自定义payload和签名算法）
 * 2. 构建带JWT认证的URL（支持 query/header/cookie/post 四种传输方式）
 * 3. SSO Token验证接口（供外部系统调用）
 * 
 * 与 TokenService 的区别：
 * - TokenService 处理平台内部的 access/refresh 双Token
 * - JWTService 处理平台与外部模块之间的认证Token
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class JWTService {
  /**
   * 为模块生成JWT Token
   * 
   * 根据模块的认证配置（authConfig）构建payload并签名
   * payload字段由配置决定，支持标准JWT字段和SSO扩展字段
   * 
   * @param {Object} user - 用户信息对象
   * @param {Object} authConfig - 认证配置
   * @param {string} authConfig.secret - 签名密钥
   * @param {string} authConfig.algorithm - 签名算法（默认HS256）
   * @param {number} authConfig.expiresIn - 过期秒数（默认3600）
   * @param {Object} authConfig.payload - payload配置（includes数组 + customFields映射）
   * @returns {string} JWT token
   */
  static generateModuleToken(user, authConfig) {
    try {
      const { secret, algorithm, expiresIn, payload: payloadConfig } = authConfig;

      // 构建payload
      const payload = {};

      // 根据配置添加用户信息字段
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

        // SSO扩展字段
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

      // 自定义字段映射：{ targetField: sourceField }
      if (payloadConfig && payloadConfig.customFields) {
        Object.keys(payloadConfig.customFields).forEach(targetField => {
          const sourceField = payloadConfig.customFields[targetField];
          if (user[sourceField] !== undefined) {
            payload[targetField] = user[sourceField];
          }
        });
      }

      // 使用jwt库的 expiresIn 自动处理过期时间，避免手动计算时钟偏差问题
      const token = jwt.sign(payload, secret, {
        algorithm: algorithm || 'HS256',
        expiresIn: expiresIn || 3600
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
   * 
   * 根据模块配置的传输方式（tokenMethod）构建认证请求：
   * - query: URL参数方式（最常用的SSO方式）
   * - header: HTTP Header方式
   * - cookie: Cookie方式
   * - post: POST表单方式
   * 
   * @param {string} moduleUrl - 模块URL
   * @param {string} token - JWT token
   * @param {Object} authConfig - 认证配置
   * @returns {Object} { url, headers, formData, method }
   */
  static buildAuthenticatedUrl(moduleUrl, token, authConfig) {
    const { tokenMethod, tokenField, ssoEndpoint } = authConfig;

    // 如果配置了SSO端点，使用SSO端点而不是模块URL
    let baseUrl = moduleUrl;
    if (ssoEndpoint) {
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
        // URL参数方式
        const separator = baseUrl.includes('?') ? '&' : '?';
        url = `${baseUrl}${separator}${tokenField || 'token'}=${encodeURIComponent(token)}`;
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
        // Cookie方式
        headers['Set-Cookie'] = `${tokenField || 'token'}=${token}; Path=/; HttpOnly; SameSite=Lax`;
        break;

      case 'post':
        // POST表单方式
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
   * 验证JWT Token
   * 
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
   * 验证SSO Token并返回标准化用户信息
   * 供外部系统调用验证token并获取用户信息
   * 
   * 注意：jwt.verify 已自动检查过期时间，无需手动检查 exp
   * 
   * @param {string} token - JWT token
   * @param {string} secret - 密钥
   * @returns {Object} { success, user, exp, iat } 或 { success: false, error }
   */
  static validateSSOToken(token, secret) {
    try {
      // jwt.verify 会自动检查 exp 字段，过期时抛出 TokenExpiredError
      const decoded = jwt.verify(token, secret);

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
