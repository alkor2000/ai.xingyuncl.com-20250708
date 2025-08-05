/**
 * 使用记录路由
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
 * @route GET /api/admin/usage-logs/export
 * @desc 导出使用记录为Excel
 * @access SuperAdmin only
 */
router.get('/export',
  requireRole(['super_admin']),
  UsageLogController.exportUsageLogs
);

module.exports = router;
