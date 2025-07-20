/**
 * 统计路由
 */

const express = require('express');
const StatsController = require('../controllers/statsController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/stats/realtime
 * @desc 获取实时统计数据
 * @access Private
 */
router.get('/realtime', StatsController.getRealtimeStats);

/**
 * @route GET /api/stats/online-users
 * @desc 获取在线用户列表
 * @access Private (Admin)
 */
router.get('/online-users', 
  requirePermission('user.manage'),
  StatsController.getOnlineUsers
);

/**
 * @route POST /api/stats/heartbeat
 * @desc 用户心跳，更新在线状态
 * @access Private
 */
router.post('/heartbeat', StatsController.heartbeat);

module.exports = router;
