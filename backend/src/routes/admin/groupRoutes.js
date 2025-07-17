/**
 * 用户分组管理路由 - 使用优化的权限中间件
 */

const express = require('express');
const UserGroupController = require('../../controllers/admin/UserGroupController');
const { requirePermission } = require('../../middleware/authMiddleware');
const { canManageGroups } = require('../../middleware/permissions');

const router = express.Router();

/**
 * @route GET /api/admin/user-groups
 * @desc 获取用户分组列表
 * @access Admin / SuperAdmin (Admin只能看到自己的组)
 */
router.get('/',
  requirePermission('user.manage'),
  UserGroupController.getUserGroups
);

/**
 * @route POST /api/admin/user-groups
 * @desc 创建用户分组
 * @access SuperAdmin only
 */
router.post('/',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.createUserGroup
);

/**
 * @route PUT /api/admin/user-groups/:id
 * @desc 更新用户分组
 * @access SuperAdmin only
 */
router.put('/:id',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.updateUserGroup
);

/**
 * @route DELETE /api/admin/user-groups/:id
 * @desc 删除用户分组
 * @access SuperAdmin only
 */
router.delete('/:id',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.deleteUserGroup
);

module.exports = router;
