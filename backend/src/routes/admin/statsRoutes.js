/**
 * 系统统计和设置路由 - 使用优化的权限中间件
 */

const express = require('express');
const SystemStatsController = require('../../controllers/admin/SystemStatsController');
const { requireRole, requirePermission } = require('../../middleware/authMiddleware');
const { canManageSystem } = require('../../middleware/permissions');

const router = express.Router();

/**
 * @route GET /api/admin/stats
 * @desc 获取系统统计信息 (包含分组统计和积分统计)
 * @access Admin / SuperAdmin (Admin只能看到自己组的统计)
 */
router.get('/',
  requireRole(['admin', 'super_admin']),
  SystemStatsController.getSystemStats
);

/**
 * @route GET /api/admin/settings
 * @desc 获取系统设置
 * @access SuperAdmin only
 */
router.get('/settings',
  requirePermission('system.all'),
  canManageSystem(),
  SystemStatsController.getSystemSettings
);

/**
 * @route PUT /api/admin/settings
 * @desc 更新系统设置
 * @access SuperAdmin only
 */
router.put('/settings',
  requirePermission('system.all'),
  canManageSystem(),
  SystemStatsController.updateSystemSettings
);

module.exports = router;
