/**
 * 认证路由
 */

const express = require('express');
const AuthController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// 登录限流配置
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5, // 每15分钟最多5次登录尝试
  message: {
    success: false,
    code: 429,
    message: '登录尝试次数过多，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 注册限流配置
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 3, // 每小时最多3次注册
  message: {
    success: false,
    code: 429,
    message: '注册次数过多，请稍后再试',
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
router.post('/login', loginLimiter, AuthController.login);

/**
 * @route POST /api/auth/register
 * @desc 用户注册
 * @access Public
 */
router.post('/register', registerLimiter, AuthController.register);

/**
 * @route GET /api/auth/me
 * @desc 获取当前用户信息
 * @access Private
 */
router.get('/me', authenticate, AuthController.getCurrentUser);

/**
 * @route POST /api/auth/refresh
 * @desc 刷新访问令牌
 * @access Private
 */
router.post('/refresh', AuthController.refreshToken);

/**
 * @route POST /api/auth/logout
 * @desc 用户登出
 * @access Private
 */
router.post('/logout', authenticate, AuthController.logout);

/**
 * @route GET /api/auth/check-email
 * @desc 检查邮箱可用性
 * @access Public
 */
router.get('/check-email', AuthController.checkEmailAvailable);

/**
 * @route GET /api/auth/check-username
 * @desc 检查用户名可用性
 * @access Public
 */
router.get('/check-username', AuthController.checkUsernameAvailable);

module.exports = router;
