/**
 * 积分管理路由
 */

const express = require('express');
const UserCreditsController = require('../../controllers/admin/UserCreditsController');
const { requirePermission } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/users/:id/credits
 * @desc 获取用户积分信息
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.get('/users/:id/credits',
  requirePermission('credits.manage'),
  UserCreditsController.getUserCredits
);

/**
 * @route PUT /api/admin/users/:id/credits
 * @desc 设置用户积分配额
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.put('/users/:id/credits',
  requirePermission('credits.manage'),
  UserCreditsController.setUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/add
 * @desc 充值用户积分
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.post('/users/:id/credits/add',
  requirePermission('credits.manage'),
  UserCreditsController.addUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/deduct
 * @desc 扣减用户积分
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.post('/users/:id/credits/deduct',
  requirePermission('credits.manage'),
  UserCreditsController.deductUserCredits
);

/**
 * @route GET /api/admin/users/:id/credits/history
 * @desc 获取用户积分使用历史
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.get('/users/:id/credits/history',
  requirePermission('credits.manage'),
  UserCreditsController.getUserCreditsHistory
);

/**
 * @route PUT /api/admin/users/:id/credits/expire
 * @desc 设置用户积分有效期
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.put('/users/:id/credits/expire',
  requirePermission('credits.manage'),
  UserCreditsController.setUserCreditsExpire
);

module.exports = router;
