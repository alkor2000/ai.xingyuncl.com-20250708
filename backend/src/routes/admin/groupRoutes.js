/**
 * 用户分组管理路由 - 使用优化的权限中间件（包含积分池功能、组有效期、站点配置和邀请码功能）
 */
const express = require('express');
const UserGroupController = require('../../controllers/admin/UserGroupController');
const { requirePermission } = require('../../middleware/authMiddleware');
const { canManageGroups } = require('../../middleware/permissions');
const { uploadSiteLogo } = require('../../middleware/systemUploadMiddleware');

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

/**
 * @route PUT /api/admin/user-groups/:id/invitation-code
 * @desc 设置组邀请码（新增）
 * @access SuperAdmin only
 */
router.put('/:id/invitation-code',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.setGroupInvitationCode
);

/**
 * @route GET /api/admin/user-groups/:id/invitation-logs
 * @desc 获取邀请码使用记录（新增）
 * @access SuperAdmin only
 */
router.get('/:id/invitation-logs',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.getInvitationCodeLogs
);

/**
 * @route PUT /api/admin/user-groups/:id/credits-pool
 * @desc 设置组积分池
 * @access SuperAdmin only
 */
router.put('/:id/credits-pool',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.setGroupCreditsPool
);

/**
 * @route POST /api/admin/user-groups/:id/distribute-credits
 * @desc 从组积分池分配积分
 * @access Admin / SuperAdmin (Admin只能管理自己的组)
 */
router.post('/:id/distribute-credits',
  requirePermission('user.manage'),
  UserGroupController.distributeGroupCredits
);

/**
 * @route PUT /api/admin/user-groups/:id/user-limit
 * @desc 设置组员上限
 * @access SuperAdmin only
 */
router.put('/:id/user-limit',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.setGroupUserLimit
);

/**
 * @route PUT /api/admin/user-groups/:id/expire-date
 * @desc 设置组有效期
 * @access SuperAdmin only
 */
router.put('/:id/expire-date',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.setGroupExpireDate
);

/**
 * @route POST /api/admin/user-groups/:id/sync-expire-date
 * @desc 同步组有效期到所有组员
 * @access SuperAdmin only
 */
router.post('/:id/sync-expire-date',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.syncGroupExpireDateToUsers
);

/**
 * @route PUT /api/admin/user-groups/:id/site-customization
 * @desc 设置组站点自定义开关
 * @access SuperAdmin only
 */
router.put('/:id/site-customization',
  requirePermission('group.manage'),
  canManageGroups(),
  UserGroupController.toggleGroupSiteCustomization
);

/**
 * @route PUT /api/admin/user-groups/:id/site-config
 * @desc 更新组站点配置
 * @access Admin / SuperAdmin (Admin只能管理自己的组)
 */
router.put('/:id/site-config',
  requirePermission('user.manage'),
  UserGroupController.updateGroupSiteConfig
);

/**
 * @route POST /api/admin/user-groups/:id/upload-logo
 * @desc 上传组Logo
 * @access Admin / SuperAdmin (Admin只能管理自己的组)
 */
router.post('/:id/upload-logo',
  requirePermission('user.manage'),
  uploadSiteLogo,
  UserGroupController.uploadGroupLogo
);

module.exports = router;
