/**
 * 认证控制器
 */

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const ResponseHelper = require('../utils/response');
const config = require('../config');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');

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

      logger.info('用户登录尝试', { email });

      // 查找用户
      const user = await User.findByEmail(email.toLowerCase());
      if (!user) {
        logger.warn('登录失败：用户不存在', { email });
        return ResponseHelper.unauthorized(res, '邮箱或密码错误');
      }

      // 验证密码（明文比较）
      if (password !== user.password_hash) {
        logger.warn('登录失败：密码错误', { email, userId: user.id });
        return ResponseHelper.unauthorized(res, '邮箱或密码错误');
      }

      // 检查用户状态
      if (user.status !== 'active') {
        logger.warn('登录失败：用户状态异常', { 
          email, 
          userId: user.id, 
          status: user.status 
        });
        return ResponseHelper.unauthorized(res, '账户已被禁用');
      }

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 生成JWT令牌
      const accessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          type: 'access'
        },
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: 'ai-platform',
          audience: 'ai-platform-users'
        }
      );

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh'
        },
        config.auth.jwt.refreshSecret,
        {
          expiresIn: config.auth.jwt.refreshExpiresIn,
          issuer: 'ai-platform',
          audience: 'ai-platform-users'
        }
      );

      // 更新用户最后登录时间
      await user.updateLastLogin();

      logger.info('用户登录成功', { 
        email, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        accessToken,
        refreshToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, '登录成功');

    } catch (error) {
      logger.error('登录处理失败:', error);
      return ResponseHelper.error(res, '登录失败');
    }
  }

  /**
   * 用户注册
   * POST /api/auth/register
   */
  static async register(req, res) {
    try {
      const { email, username, password } = req.body;

      // 验证输入
      if (!email || !username || !password) {
        return ResponseHelper.validation(res, ['邮箱、用户名和密码不能为空']);
      }

      if (password.length < 6) {
        return ResponseHelper.validation(res, ['密码长度至少6位']);
      }

      logger.info('用户注册尝试', { email, username });

      // 检查邮箱是否已存在
      const existingUser = await User.findByEmail(email.toLowerCase());
      if (existingUser) {
        return ResponseHelper.validation(res, ['邮箱已被注册']);
      }

      // 创建用户（明文密码）
      const user = await User.create({
        email: email.toLowerCase(),
        username,
        password, // 直接使用明文密码
        role: 'user',
        status: 'active',
        token_quota: 10000
      });

      // 获取新用户权限
      const permissions = await user.getPermissions();

      logger.info('用户注册成功', { 
        email, 
        userId: user.id 
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions
      }, '注册成功', 201);

    } catch (error) {
      logger.error('注册处理失败:', error);
      return ResponseHelper.error(res, '注册失败');
    }
  }

  /**
   * 获取当前用户信息
   * GET /api/auth/me
   */
  static async getCurrentUser(req, res) {
    try {
      const userId = req.user.id;
      
      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 获取用户权限
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
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return ResponseHelper.unauthorized(res, '刷新令牌不能为空');
      }

      // 验证刷新令牌
      const decoded = jwt.verify(refreshToken, config.auth.jwt.refreshSecret);

      if (decoded.type !== 'refresh') {
        return ResponseHelper.unauthorized(res, '无效的刷新令牌');
      }

      // 获取用户信息
      const user = await User.findById(decoded.userId);
      if (!user || user.status !== 'active') {
        return ResponseHelper.unauthorized(res, '用户不存在或已被禁用');
      }

      // 生成新的访问令牌
      const newAccessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          type: 'access'
        },
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: 'ai-platform',
          audience: 'ai-platform-users'
        }
      );

      logger.info('令牌刷新成功', { userId: user.id });

      return ResponseHelper.success(res, {
        accessToken: newAccessToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, '令牌刷新成功');

    } catch (error) {
      logger.error('令牌刷新失败:', error);
      return ResponseHelper.unauthorized(res, '刷新令牌无效或已过期');
    }
  }

  /**
   * 用户登出
   * POST /api/auth/logout
   */
  static async logout(req, res) {
    try {
      const userId = req.user?.id;

      if (userId) {
        logger.info('用户登出', { userId });
      }

      // 这里可以将令牌加入黑名单，但简单起见直接返回成功
      // TODO: 实现令牌黑名单机制

      return ResponseHelper.success(res, null, '退出登录成功');
    } catch (error) {
      logger.error('登出处理失败:', error);
      return ResponseHelper.error(res, '退出登录失败');
    }
  }
}

module.exports = AuthController;
