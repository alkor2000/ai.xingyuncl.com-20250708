/**
 * 认证控制器
 */

const User = require('../models/User');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { ValidationError, AuthenticationError } = require('../utils/errors');

class AuthController {
  /**
   * 用户登录
   * POST /api/auth/login
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      
      // 验证输入
      if (!email || !password) {
        return ResponseHelper.validation(res, ['邮箱和密码不能为空']);
      }

      // 验证用户凭证
      const user = await User.validateCredentials(email, password);
      
      // 更新登录信息
      await user.updateLastLogin(req.ip);
      
      // 生成JWT令牌
      const tokens = AuthController.generateTokens(user);
      
      // 获取用户权限
      const permissions = await user.getPermissions();
      
      logger.info('用户登录成功', { 
        userId: user.id, 
        email: user.email,
        ip: req.ip 
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        ...tokens
      }, '登录成功');

    } catch (error) {
      logger.error('用户登录失败:', error);
      
      if (error instanceof ValidationError || error instanceof AuthenticationError) {
        return ResponseHelper.unauthorized(res, error.message);
      }
      
      return ResponseHelper.error(res, '登录失败，请稍后重试');
    }
  }

  /**
   * 用户注册
   * POST /api/auth/register
   */
  static async register(req, res) {
    try {
      const { email, username, password, confirmPassword } = req.body;

      // 验证输入
      const errors = [];
      if (!email) errors.push('邮箱不能为空');
      if (!username) errors.push('用户名不能为空');
      if (!password) errors.push('密码不能为空');
      if (!confirmPassword) errors.push('确认密码不能为空');
      if (password !== confirmPassword) errors.push('两次输入的密码不一致');
      if (password && password.length < 6) errors.push('密码长度至少6位');
      
      if (errors.length > 0) {
        return ResponseHelper.validation(res, errors);
      }

      // 创建用户
      const user = await User.create({
        email: email.toLowerCase(),
        username,
        password
      });

      logger.info('用户注册成功', { 
        userId: user.id, 
        email: user.email,
        username: user.username,
        ip: req.ip 
      });

      return ResponseHelper.success(res, {
        user: user.toJSON()
      }, '注册成功', 201);

    } catch (error) {
      logger.error('用户注册失败:', error);
      
      if (error instanceof ValidationError) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, '注册失败，请稍后重试');
    }
  }

  /**
   * 获取当前用户信息
   * GET /api/auth/me
   */
  static async getCurrentUser(req, res) {
    try {
      const user = req.user;
      const permissions = await user.getPermissions();

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions
      }, '获取用户信息成功');

    } catch (error) {
      logger.error('获取用户信息失败:', error);
      return ResponseHelper.error(res, '获取用户信息失败');
    }
  }

  /**
   * 刷新访问令牌
   * POST /api/auth/refresh
   */
  static async refreshToken(req, res) {
    try {
      const user = req.user;
      
      // 生成新的令牌
      const tokens = AuthController.generateTokens(user);

      logger.info('令牌刷新成功', { userId: user.id });

      return ResponseHelper.success(res, tokens, '令牌刷新成功');

    } catch (error) {
      logger.error('令牌刷新失败:', error);
      return ResponseHelper.error(res, '令牌刷新失败');
    }
  }

  /**
   * 用户登出
   * POST /api/auth/logout
   */
  static async logout(req, res) {
    try {
      // 这里可以添加令牌黑名单逻辑
      
      logger.info('用户登出', { userId: req.user?.id });
      
      return ResponseHelper.success(res, null, '登出成功');
    } catch (error) {
      logger.error('用户登出失败:', error);
      return ResponseHelper.error(res, '登出失败');
    }
  }

  /**
   * 检查邮箱可用性
   * GET /api/auth/check-email?email=xxx
   */
  static async checkEmailAvailable(req, res) {
    try {
      const { email } = req.query;
      
      if (!email) {
        return ResponseHelper.validation(res, ['邮箱不能为空']);
      }

      const existingUser = await User.findByEmail(email.toLowerCase());
      const available = !existingUser;

      return ResponseHelper.success(res, { available }, '邮箱检查完成');

    } catch (error) {
      logger.error('检查邮箱可用性失败:', error);
      return ResponseHelper.error(res, '检查失败');
    }
  }

  /**
   * 检查用户名可用性
   * GET /api/auth/check-username?username=xxx
   */
  static async checkUsernameAvailable(req, res) {
    try {
      const { username } = req.query;
      
      if (!username) {
        return ResponseHelper.validation(res, ['用户名不能为空']);
      }

      const existingUser = await User.findByUsername(username);
      const available = !existingUser;

      return ResponseHelper.success(res, { available }, '用户名检查完成');

    } catch (error) {
      logger.error('检查用户名可用性失败:', error);
      return ResponseHelper.error(res, '检查失败');
    }
  }

  /**
   * 生成JWT令牌 - 修正配置路径
   */
  static generateTokens(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role
    };

    const accessToken = jwt.sign(
      { ...payload, type: 'access' },
      config.auth.jwt.accessSecret,
      {
        expiresIn: config.auth.jwt.accessExpiresIn,
        audience: config.auth.jwt.audience,
        issuer: config.auth.jwt.issuer
      }
    );

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      config.auth.jwt.refreshSecret,
      {
        expiresIn: config.auth.jwt.refreshExpiresIn,
        audience: config.auth.jwt.audience,
        issuer: config.auth.jwt.issuer
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: config.auth.jwt.accessExpiresIn
    };
  }
}

module.exports = AuthController;
