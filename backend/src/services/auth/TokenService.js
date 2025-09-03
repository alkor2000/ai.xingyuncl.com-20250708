/**
 * Token服务 - 处理JWT令牌生成、刷新和管理
 */

const jwt = require('jsonwebtoken');
const SystemConfig = require('../../models/SystemConfig');
const config = require('../../config');
const redisConnection = require('../../database/redis');
const logger = require('../../utils/logger');

class TokenService {
  /**
   * 获取刷新令牌过期时间
   */
  static async getRefreshTokenExpiry() {
    try {
      const loginConfig = await SystemConfig.getLoginSettings();
      const days = loginConfig.refresh_token_days || 14;
      return `${days}d`;
    } catch (error) {
      logger.error('获取刷新令牌过期时间失败，使用默认值:', error);
      return config.auth.jwt.refreshExpiresIn;
    }
  }
  
  /**
   * 生成访问令牌和刷新令牌
   */
  static async generateTokenPair(user, isSSOUser = false) {
    // 生成访问令牌
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      type: 'access'
    };
    
    if (isSSOUser) {
      tokenPayload.ssoUser = true;
      tokenPayload.uuid = user.uuid;
    }
    
    // 添加唯一标识符，用于token管理
    const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    tokenPayload.jti = jti;
    
    const accessToken = jwt.sign(
      tokenPayload,
      config.auth.jwt.accessSecret,
      {
        expiresIn: config.auth.jwt.accessExpiresIn,
        issuer: config.auth.jwt.issuer,
        audience: config.auth.jwt.audience
      }
    );
    
    // 获取动态的刷新令牌过期时间
    const refreshTokenExpiry = await TokenService.getRefreshTokenExpiry();
    
    const refreshToken = jwt.sign(
      {
        userId: user.id,
        type: 'refresh',
        jti: `refresh-${jti}`
      },
      config.auth.jwt.refreshSecret,
      {
        expiresIn: refreshTokenExpiry,
        issuer: config.auth.jwt.issuer,
        audience: config.auth.jwt.audience
      }
    );
    
    return {
      accessToken,
      refreshToken,
      expiresIn: config.auth.jwt.accessExpiresIn
    };
  }
  
  /**
   * 刷新访问令牌
   */
  static async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new Error('刷新令牌不能为空');
    }
    
    // 验证刷新令牌
    const decoded = jwt.verify(refreshToken, config.auth.jwt.refreshSecret);
    
    if (decoded.type !== 'refresh') {
      throw new Error('无效的刷新令牌');
    }
    
    // 检查refresh token是否在黑名单中
    if (decoded.jti && redisConnection.isConnected) {
      const isBlacklisted = await redisConnection.exists(`token_blacklist:${decoded.jti}`);
      if (isBlacklisted) {
        throw new Error('刷新令牌已失效');
      }
    }
    
    return decoded.userId;
  }
  
  /**
   * 将Token加入黑名单
   */
  static async blacklistToken(token, userId) {
    if (!token || !redisConnection.isConnected) {
      return false;
    }
    
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.jti) {
        // 计算token剩余有效时间
        const now = Math.floor(Date.now() / 1000);
        const ttl = decoded.exp - now;
        
        if (ttl > 0) {
          // 将token加入黑名单，过期时间与token过期时间一致
          await redisConnection.set(`token_blacklist:${decoded.jti}`, userId, ttl);
          logger.info('Token已加入黑名单', { userId, jti: decoded.jti, ttl });
          return true;
        }
      }
    } catch (error) {
      logger.error('加入黑名单失败:', error);
    }
    
    return false;
  }
}

module.exports = TokenService;
