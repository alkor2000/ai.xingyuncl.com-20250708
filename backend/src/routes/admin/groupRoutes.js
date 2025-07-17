/**
 * 用户分组管理路由
 */

const express = require('express');
const UserGroupController = require('../../controllers/admin/UserGroupController');
const { requirePermission } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/user-groups
 * @desc 获取用户分组列表
 * @access Admin / SuperAdmin
 */
router.get('/',
  requirePermission('user.manage'),
  UserGroupController.getUserGroups
);

/**
 * @route POST /api/admin/user-groups
 * @desc 创建用户分组
 * @access SuperAdmin
 */
router.post('/',
  requirePermission('group.manage'),
  UserGroupController.createUserGroup
);

/**
 * @route PUT /api/admin/user-groups/:id
 * @desc 更新用户分组
 * @access SuperAdmin
 */
router.put('/:id',
  requirePermission('group.manage'),
  UserGroupController.updateUserGroup
);

/**
 * @route DELETE /api/admin/user-groups/:id
 * @desc 删除用户分组
 * @access SuperAdmin
 */
router.delete('/:id',
  requirePermission('group.manage'),
  UserGroupController.deleteUserGroup
);

module.exports = router;
