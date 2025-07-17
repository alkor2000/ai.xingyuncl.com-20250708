/**
 * 系统统计和设置路由
 */

const express = require('express');
const SystemStatsController = require('../../controllers/admin/SystemStatsController');
const { requireRole, requirePermission } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/stats
 * @desc 获取系统统计信息 (包含分组统计和积分统计)
 * @access Admin / SuperAdmin
 */
router.get('/',
  requireRole(['admin', 'super_admin']),
  SystemStatsController.getSystemStats
);

/**
 * @route GET /api/admin/settings
 * @desc 获取系统设置
 * @access SuperAdmin
 */
router.get('/settings',
  requirePermission('system.all'),
  SystemStatsController.getSystemSettings
);

/**
 * @route PUT /api/admin/settings
 * @desc 更新系统设置
 * @access SuperAdmin
 */
router.put('/settings',
  requirePermission('system.all'),
  SystemStatsController.updateSystemSettings
);

module.exports = router;
