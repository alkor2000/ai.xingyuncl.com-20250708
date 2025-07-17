/**
 * 用户管理路由
 */

const express = require('express');
const UserManagementController = require('../../controllers/admin/UserManagementController');
const { requirePermission } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/users
 * @desc 获取用户列表 (支持分组过滤)
 * @access Admin / SuperAdmin
 */
router.get('/',
  requirePermission('user.manage'),
  UserManagementController.getUsers
);

/**
 * @route POST /api/admin/users
 * @desc 创建用户 (支持分组设置和积分配额)
 * @access Admin / SuperAdmin
 */
router.post('/',
  requirePermission('user.manage'),
  UserManagementController.createUser
);

/**
 * @route GET /api/admin/users/:id
 * @desc 获取用户详情 (包含积分信息)
 * @access Admin / SuperAdmin
 */
router.get('/:id',
  requirePermission('user.manage'),
  UserManagementController.getUserDetail
);

/**
 * @route PUT /api/admin/users/:id
 * @desc 更新用户 (支持分组更新和积分配额)
 * @access Admin / SuperAdmin
 */
router.put('/:id',
  requirePermission('user.manage'),
  UserManagementController.updateUser
);

/**
 * @route PUT /api/admin/users/:id/password
 * @desc 重置用户密码
 * @access Admin / SuperAdmin
 */
router.put('/:id/password',
  requirePermission('user.manage'),
  UserManagementController.resetUserPassword
);

/**
 * @route DELETE /api/admin/users/:id
 * @desc 删除用户
 * @access Admin / SuperAdmin
 */
router.delete('/:id',
  requirePermission('user.manage'),
  UserManagementController.deleteUser
);

module.exports = router;
