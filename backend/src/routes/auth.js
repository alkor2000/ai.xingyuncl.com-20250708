/**
 * 认证路由 - 支持动态速率限制配置和SSO单点登录
 */

const express = require('express');
const AuthController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const rateLimitService = require('../services/rateLimitService');

const router = express.Router();

// 创建动态速率限制中间件包装器
const dynamicRateLimit = (type) => {
  return async (req, res, next) => {
    try {
      const limiter = await rateLimitService.getLimiter(type);
      limiter(req, res, next);
    } catch (error) {
      console.error(`获取速率限制器失败 (${type}):`, error);
      // 失败时继续处理请求，不阻塞
      next();
    }
  };
};

/**
 * @route POST /api/auth/sso
 * @desc SSO单点登录
 * @access Public
 */
router.post('/sso', dynamicRateLimit('auth'), AuthController.ssoLogin);

/**
 * @route POST /api/auth/login
 * @desc 用户登录
 * @access Public
 */
router.post('/login', dynamicRateLimit('auth'), AuthController.login);

/**
 * @route POST /api/auth/send-email-code
 * @desc 发送邮箱验证码
 * @access Public
 */
router.post('/send-email-code', dynamicRateLimit('emailCode'), AuthController.sendEmailCode);

/**
 * @route POST /api/auth/login-by-code
 * @desc 邮箱验证码登录
 * @access Public
 */
router.post('/login-by-code', dynamicRateLimit('auth'), AuthController.loginByEmailCode);

/**
 * @route POST /api/auth/login-by-email-password
 * @desc 邮箱+密码+验证码登录（强制验证模式）
 * @access Public
 */
router.post('/login-by-email-password', dynamicRateLimit('auth'), AuthController.loginByEmailPassword);

/**
 * @route POST /api/auth/register
 * @desc 用户注册
 * @access Public
 */
router.post('/register', dynamicRateLimit('auth'), AuthController.register);

/**
 * @route GET /api/auth/me
 * @desc 获取当前用户信息
 * @access Private
 */
router.get('/me', authenticate, AuthController.getCurrentUser);

/**
 * @route PUT /api/auth/profile
 * @desc 更新个人信息
 * @access Private
 */
router.put('/profile', authenticate, AuthController.updateProfile);

/**
 * @route PUT /api/auth/password
 * @desc 修改密码
 * @access Private
 */
router.put('/password', authenticate, AuthController.changePassword);

/**
 * @route GET /api/auth/credit-history
 * @desc 获取积分历史
 * @access Private
 */
router.get('/credit-history', authenticate, AuthController.getCreditHistory);

/**
 * @route POST /api/auth/refresh
 * @desc 刷新访问令牌
 * @access Public
 */
router.post('/refresh', dynamicRateLimit('auth'), AuthController.refreshToken);

/**
 * @route POST /api/auth/logout
 * @desc 用户登出
 * @access Private
 */
router.post('/logout', authenticate, AuthController.logout);

module.exports = router;
