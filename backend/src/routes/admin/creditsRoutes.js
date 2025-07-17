/**
 * 积分管理路由 - 使用优化的权限中间件
 */

const express = require('express');
const UserCreditsController = require('../../controllers/admin/UserCreditsController');
const { requirePermission } = require('../../middleware/authMiddleware');
const { canViewCredits, canManageCredits } = require('../../middleware/permissions');

const router = express.Router();

/**
 * @route GET /api/admin/users/:id/credits
 * @desc 获取用户积分信息
 * @access Admin / SuperAdmin (Admin只能查看同组)
 */
router.get('/users/:id/credits',
  requirePermission('credits.manage'),
  canViewCredits(),
  UserCreditsController.getUserCredits
);

/**
 * @route PUT /api/admin/users/:id/credits
 * @desc 设置用户积分配额
 * @access SuperAdmin only
 */
router.put('/users/:id/credits',
  requirePermission('credits.manage'),
  canManageCredits(),
  UserCreditsController.setUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/add
 * @desc 充值用户积分
 * @access SuperAdmin only
 */
router.post('/users/:id/credits/add',
  requirePermission('credits.manage'),
  canManageCredits(),
  UserCreditsController.addUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/deduct
 * @desc 扣减用户积分
 * @access SuperAdmin only
 */
router.post('/users/:id/credits/deduct',
  requirePermission('credits.manage'),
  canManageCredits(),
  UserCreditsController.deductUserCredits
);

/**
 * @route GET /api/admin/users/:id/credits/history
 * @desc 获取用户积分使用历史
 * @access Admin / SuperAdmin (Admin只能查看同组)
 */
router.get('/users/:id/credits/history',
  requirePermission('credits.manage'),
  canViewCredits(),
  UserCreditsController.getUserCreditsHistory
);

/**
 * @route PUT /api/admin/users/:id/credits/expire
 * @desc 设置用户积分有效期
 * @access SuperAdmin only
 */
router.put('/users/:id/credits/expire',
  requirePermission('credits.manage'),
  canManageCredits(),
  UserCreditsController.setUserCreditsExpire
);

module.exports = router;
