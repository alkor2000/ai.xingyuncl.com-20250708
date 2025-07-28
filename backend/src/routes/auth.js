/**
 * 认证路由
 */

const express = require('express');
const AuthController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// 认证相关的限流配置
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10, // 每15分钟最多10次认证请求
  message: {
    success: false,
    code: 429,
    message: '认证请求过于频繁，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 邮箱验证码限流配置
const emailCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 5, // 每小时最多5次发送请求
  message: {
    success: false,
    code: 429,
    message: '发送验证码过于频繁，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * @route POST /api/auth/login
 * @desc 用户登录
 * @access Public
 */
router.post('/login', authLimiter, AuthController.login);

/**
 * @route POST /api/auth/send-email-code
 * @desc 发送邮箱验证码
 * @access Public
 */
router.post('/send-email-code', emailCodeLimiter, AuthController.sendEmailCode);

/**
 * @route POST /api/auth/login-by-code
 * @desc 邮箱验证码登录
 * @access Public
 */
router.post('/login-by-code', authLimiter, AuthController.loginByEmailCode);

/**
 * @route POST /api/auth/login-by-email-password
 * @desc 邮箱+密码+验证码登录（强制验证模式）
 * @access Public
 */
router.post('/login-by-email-password', authLimiter, AuthController.loginByEmailPassword);

/**
 * @route POST /api/auth/register
 * @desc 用户注册
 * @access Public
 */
router.post('/register', authLimiter, AuthController.register);

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
router.post('/refresh', authLimiter, AuthController.refreshToken);

/**
 * @route POST /api/auth/logout
 * @desc 用户登出
 * @access Private
 */
router.post('/logout', authenticate, AuthController.logout);

module.exports = router;
