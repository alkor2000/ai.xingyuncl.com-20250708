/**
 * 服务API路由 - 供外部服务调用
 * 
 * v1.1 (2026-03-01):
 *   - 移除硬编码rateLimit，受全局限流统一管理
 */

const express = require('express');
const APIServiceController = require('../../controllers/admin/APIServiceController');

const router = express.Router();

/**
 * @route POST /api/services/deduct-credits
 * @desc 扣除用户积分 - 核心API
 * @headers X-Service-ID, X-API-Key
 * @body {user_id, action_type, request_id, description}
 */
router.post('/deduct-credits', APIServiceController.deductCredits);

module.exports = router;
