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

/**
 * @route POST /api/auth/login
 * @desc 用户登录
 * @access Public
 */
router.post('/login', authLimiter, AuthController.login);

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
