/**
 * 服务API路由 - 供外部服务调用
 */

const express = require('express');
const APIServiceController = require('../../controllers/admin/APIServiceController');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// API服务限流配置
const serviceLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 60, // 每分钟最多60次请求
  message: {
    success: false,
    code: 429,
    message: 'API请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // 基于service-id进行限流
    return req.headers['x-service-id'] || req.ip;
  }
});

// 应用限流中间件
router.use(serviceLimiter);

/**
 * @route POST /api/services/deduct-credits
 * @desc 扣除用户积分 - 核心API
 * @headers X-Service-ID, X-API-Key
 * @body {user_id, action_type, request_id, description}
 */
router.post('/deduct-credits', APIServiceController.deductCredits);

module.exports = router;
