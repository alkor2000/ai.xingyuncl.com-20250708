/**
 * 认证服务
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const logger = require('../utils/logger');
const { 
  AuthenticationError, 
  AuthorizationError, 
  ValidationError 
} = require('../utils/errors');

class AuthService {
  /**
   * 生成访问令牌
   */
  static generateAccessToken(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      type: 'access'
    };

    return jwt.sign(payload, config.auth.jwt.accessSecret, {
      expiresIn: config.auth.jwt.accessExpiresIn,
      issuer: config.auth.jwt.issuer,
      audience: config.auth.jwt.audience
    });
  }

  /**
   * 生成刷新令牌
   */
  static generateRefreshToken(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      type: 'refresh'
    };

    return jwt.sign(payload, config.auth.jwt.refreshSecret, {
      expiresIn: config.auth.jwt.refreshExpiresIn,
      issuer: config.auth.jwt.issuer,
      audience: config.auth.jwt.audience
    });
  }

  /**
   * 验证访问令牌
   */
  static async verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, config.auth.jwt.accessSecret, {
        issuer: config.auth.jwt.issuer,
        audience: config.auth.jwt.audience
      });

      if (decoded.type !== 'access') {
        throw new AuthenticationError('无效的令牌类型');
      }

      // 验证用户是否仍然存在且状态正常
      const user = await User.findById(decoded.userId);
      if (!user || user.status !== 'active') {
        throw new AuthenticationError('用户不存在或已被禁用');
      }

      return { user, decoded };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('无效的访问令牌');
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('访问令牌已过期');
      }
      throw error;
    }
  }

  /**
   * 验证刷新令牌
   */
  static async verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, config.auth.jwt.refreshSecret, {
        issuer: config.auth.jwt.issuer,
        audience: config.auth.jwt.audience
      });

      if (decoded.type !== 'refresh') {
        throw new AuthenticationError('无效的令牌类型');
      }

      // 验证用户是否仍然存在且状态正常
      const user = await User.findById(decoded.userId);
      if (!user || user.status !== 'active') {
        throw new AuthenticationError('用户不存在或已被禁用');
      }

      return { user, decoded };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('无效的刷新令牌');
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('刷新令牌已过期');
      }
      throw error;
    }
  }

  /**
   * 用户注册
   */
  static async register(userData) {
    try {
      const { email, username, password } = userData;

      // 基础验证
      if (!email || !username || !password) {
        throw new ValidationError('邮箱、用户名和密码不能为空');
      }

      // 邮箱格式验证
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new ValidationError('邮箱格式不正确');
      }

      // 用户名验证
      const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
      if (!usernameRegex.test(username)) {
        throw new ValidationError('用户名只能包含字母、数字、下划线和横线，长度3-20个字符');
      }

      // 密码强度验证
      if (password.length < 6) {
        throw new ValidationError('密码长度至少6个字符');
      }

      // 创建用户
      const newUser = await User.create({
        email: email.toLowerCase(),
        username,
        password,
        role: 'user' // 新注册用户默认为普通用户
      });

      logger.info('用户注册成功', { 
        userId: newUser.id, 
        email: newUser.email, 
        username: newUser.username 
      });

      return newUser;
    } catch (error) {
      logger.error('用户注册失败:', error);
      throw error;
    }
  }

  /**
   * 用户登录
   */
  static async login(credentials) {
    try {
      const { email, password } = credentials;

      // 基础验证
      if (!email || !password) {
        throw new ValidationError('邮箱和密码不能为空');
      }

      // 查找用户
      const user = await User.findByEmail(email.toLowerCase());
      if (!user) {
        throw new AuthenticationError('邮箱或密码错误');
      }

      // 检查用户状态
      if (user.status !== 'active') {
        throw new AuthorizationError('账户已被禁用，请联系管理员');
      }

      // 验证密码
      const isPasswordValid = await user.verifyPassword(password);
      if (!isPasswordValid) {
        throw new AuthenticationError('邮箱或密码错误');
      }

      // 更新最后登录时间
      await user.updateLastLogin();

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 生成令牌
      const accessToken = AuthService.generateAccessToken(user);
      const refreshToken = AuthService.generateRefreshToken(user);

      logger.info('用户登录成功', { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      });

      return {
        user: user.toJSON(),
        permissions,
        tokens: {
          accessToken,
          refreshToken
        }
      };
    } catch (error) {
      logger.error('用户登录失败:', error);
      throw error;
    }
  }

  /**
   * 刷新令牌
   */
  static async refreshToken(refreshToken) {
    try {
      if (!refreshToken) {
        throw new ValidationError('刷新令牌不能为空');
      }

      // 验证刷新令牌
      const { user } = await AuthService.verifyRefreshToken(refreshToken);

      // 获取最新的用户权限
      const permissions = await user.getPermissions();

      // 生成新的访问令牌
      const newAccessToken = AuthService.generateAccessToken(user);
      const newRefreshToken = AuthService.generateRefreshToken(user);

      logger.info('令牌刷新成功', { userId: user.id });

      return {
        user: user.toJSON(),
        permissions,
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken
        }
      };
    } catch (error) {
      logger.error('令牌刷新失败:', error);
      throw error;
    }
  }

  /**
   * 检查权限
   */
  static async checkPermission(userId, permission) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new AuthenticationError('用户不存在');
      }

      return await user.hasPermission(permission);
    } catch (error) {
      logger.error('权限检查失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户信息
   */
  static async getUserInfo(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new AuthenticationError('用户不存在');
      }

      const permissions = await user.getPermissions();

      return {
        user: user.toJSON(),
        permissions
      };
    } catch (error) {
      logger.error('获取用户信息失败:', error);
      throw error;
    }
  }
}

module.exports = AuthService;
