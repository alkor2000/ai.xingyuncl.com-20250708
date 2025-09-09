/**
 * 数据分析路由
 */

const express = require('express');
const AnalyticsController = require('../../controllers/admin/AnalyticsController');
const { requireRole } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/analytics
 * @desc 获取综合分析数据
 * @access Admin / SuperAdmin
 */
router.get('/',
  requireRole(['admin', 'super_admin']),
  AnalyticsController.getAnalytics
);

/**
 * @route GET /api/admin/analytics/export
 * @desc 导出分析报表
 * @access Admin / SuperAdmin
 */
router.get('/export',
  requireRole(['admin', 'super_admin']),
  AnalyticsController.exportAnalytics
);

/**
 * @route GET /api/admin/analytics/dashboard
 * @desc 获取实时数据看板
 * @access Admin / SuperAdmin
 */
router.get('/dashboard',
  requireRole(['admin', 'super_admin']),
  AnalyticsController.getDashboard
);

module.exports = router;
