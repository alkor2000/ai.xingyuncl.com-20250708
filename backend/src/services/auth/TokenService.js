/**
 * Token服务 - JWT令牌生成、刷新和管理
 * 
 * 职责：
 * 1. 生成 access/refresh 双Token
 * 2. 刷新访问令牌
 * 3. Token黑名单管理（基于Redis）
 * 
 * 安全设计：
 * - access 和 refresh token 使用不同的 secret 签名
 * - jti（JWT ID）使用 crypto 生成高熵随机值
 * - Token黑名单的TTL与token过期时间一致，不浪费Redis空间
 * - refresh token 过期时间从数据库动态读取
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const SystemConfig = require('../../models/SystemConfig');
const config = require('../../config');
const redisConnection = require('../../database/redis');
const logger = require('../../utils/logger');

class TokenService {
  /**
   * 获取刷新令牌过期时间（从数据库动态读取）
   * 
   * @returns {string} 过期时间字符串，如 '14d'
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
   * 生成唯一的JWT ID（jti）
   * 使用 crypto.randomBytes 确保足够的熵，防止碰撞
   * 
   * @param {number} userId - 用户ID，作为前缀便于日志追踪
   * @returns {string} 格式：{userId}-{timestamp}-{randomHex}
   */
  static _generateJti(userId) {
    const timestamp = Date.now();
    const randomPart = crypto.randomBytes(16).toString('hex');
    return `${userId}-${timestamp}-${randomPart}`;
  }

  /**
   * 生成访问令牌和刷新令牌
   * 
   * @param {Object} user - 用户实例
   * @param {boolean} isSSOUser - 是否SSO用户
   * @returns {Object} { accessToken, refreshToken, expiresIn }
   */
  static async generateTokenPair(user, isSSOUser = false) {
    // 生成唯一标识符
    const jti = TokenService._generateJti(user.id);

    // 构建访问令牌payload
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      type: 'access',
      jti
    };

    // SSO用户附加标识
    if (isSSOUser) {
      tokenPayload.ssoUser = true;
      tokenPayload.uuid = user.uuid;
    }

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
   * 
   * 验证refresh token有效性，返回用户ID供调用方生成新token
   * 
   * @param {string} refreshToken - 刷新令牌
   * @returns {number} userId
   * @throws {Error} 令牌无效或已失效
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
   * 
   * 使用Redis存储黑名单，TTL与token过期时间一致
   * Redis不可用时静默失败（降级策略）
   * 
   * @param {string} token - JWT令牌
   * @param {number} userId - 用户ID
   * @returns {boolean} 是否成功加入黑名单
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
