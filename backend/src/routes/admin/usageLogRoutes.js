/**
 * 使用记录路由
 * 
 * 更新记录：
 * - v1.1: 新增 /can-view-chat 接口，用于前端判断是否显示查看按钮
 */

const express = require('express');
const UsageLogController = require('../../controllers/admin/UsageLogController');
const { requireRole } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/usage-logs
 * @desc 获取使用记录列表
 * @access Admin / SuperAdmin
 */
router.get('/',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getUsageLogs
);

/**
 * @route GET /api/admin/usage-logs/summary
 * @desc 获取使用统计汇总
 * @access Admin / SuperAdmin
 */
router.get('/summary',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getUsageSummary
);

/**
 * @route GET /api/admin/usage-logs/can-view-chat
 * @desc 检查当前用户是否有查看对话记录的权限
 * @access Admin / SuperAdmin
 */
router.get('/can-view-chat',
  requireRole(['admin', 'super_admin']),
  UsageLogController.checkCanViewChat
);

/**
 * @route GET /api/admin/usage-logs/export
 * @desc 导出使用记录为Excel
 * @access SuperAdmin only
 */
router.get('/export',
  requireRole(['super_admin']),
  UsageLogController.exportUsageLogs
);

/**
 * @route GET /api/admin/conversations/:conversationId/messages
 * @desc 获取会话的完整消息记录（管理员专用）
 * @access Admin / SuperAdmin
 * @note 组管理员需要 can_view_chat_history = 1 才能访问
 */
router.get('/conversations/:conversationId/messages',
  requireRole(['admin', 'super_admin']),
  UsageLogController.getConversationMessages
);

module.exports = router;
