/**
 * 使用记录路由
 * 
 * v1.1 - 新增 /can-view-chat 接口
 * v1.2 - 新增 /chart 积分消耗柱状图接口
 */

const express = require('express');
const UsageLogController = require('../../controllers/admin/UsageLogController');
const { requireRole } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/usage-logs
 * @desc 获取使用记录列表
 */
router.get('/',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getUsageLogs
);

/**
 * @route GET /api/admin/usage-logs/summary
 * @desc 获取使用统计汇总
 */
router.get('/summary',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getUsageSummary
);

/**
 * @route GET /api/admin/usage-logs/chart
 * @desc v1.2新增：获取积分消耗柱状图数据
 * @query granularity - 时间粒度: hour/day/week/month
 * @query startDate - 开始日期
 * @query endDate - 结束日期
 * @query groupId - 组ID（可选）
 */
router.get('/chart',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getCreditsChart
);

/**
 * @route GET /api/admin/usage-logs/can-view-chat
 * @desc 检查当前用户是否有查看对话记录的权限
 */
router.get('/can-view-chat',
  requireRole(['admin', 'super_admin']),
  UsageLogController.checkCanViewChat
);

/**
 * @route GET /api/admin/usage-logs/export
 * @desc 导出使用记录为Excel（仅超管）
 */
router.get('/export',
  requireRole(['super_admin']),
  UsageLogController.exportUsageLogs
);

/**
 * @route GET /api/admin/conversations/:conversationId/messages
 * @desc 获取会话消息记录
 */
router.get('/conversations/:conversationId/messages',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getConversationMessages
);

module.exports = router;
