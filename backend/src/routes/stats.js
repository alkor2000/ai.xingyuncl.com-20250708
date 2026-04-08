/**
 * 统计路由
 * 
 * v1.1 变更：
 *   - 新增 GET /api/stats/my-group-announcement 端点
 *   - 允许所有认证用户读取自己所在组的公告（无需admin权限）
 *   - 解决普通用户登录Dashboard时请求/admin/user-groups/:id/announcement返回403的问题
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

/**
 * @route GET /api/stats/user-credits
 * @desc 获取用户积分统计信息
 * @access Private
 */
router.get('/user-credits', StatsController.getUserCreditsStats);

/**
 * @route GET /api/stats/my-group-announcement
 * @desc 获取当前用户所在组的公告（所有认证用户可访问）
 * @access Private（任何已登录用户）
 * 
 * v1.1 新增：解决普通用户访问/admin/路径下组公告端点被403拒绝的问题
 * 普通用户只能读取自己所在组的公告，不需要admin权限
 */
router.get('/my-group-announcement', StatsController.getMyGroupAnnouncement);

module.exports = router;
