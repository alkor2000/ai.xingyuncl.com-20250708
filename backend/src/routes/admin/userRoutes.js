/**
 * 用户管理路由 - 使用优化的权限中间件
 * 
 * 功能包含：
 * - 用户CRUD操作
 * - 账号有效期管理
 * - 模型权限管理
 * - 批量创建用户（v1.1新增）
 * 
 * 更新记录：
 * - v1.1: 新增 POST /batch-create 批量创建用户路由
 */
const express = require('express');
const UserManagementController = require('../../controllers/admin/UserManagementController');
const { requirePermission } = require('../../middleware/authMiddleware');
const { canManageUser, canCreateUser, restrictFieldsForGroupAdmin } = require('../../middleware/permissions');
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
  canCreateUser(),
  UserManagementController.createUser
);

/**
 * @route POST /api/admin/users/batch-create
 * @desc 批量创建用户（v1.1新增）
 * @body {
 *   group_id: number,           // 目标组ID（必填）
 *   username_prefix: string,    // 用户名前缀（必填）
 *   username_connector: string, // 连接符，默认'_'
 *   start_number: number,       // 起始序号，默认1
 *   number_digits: number,      // 序号位数，默认3
 *   count: number,              // 创建数量（必填，1-500）
 *   credits_per_user: number,   // 每用户积分，默认0
 *   password: string            // 统一密码（可选，不填则随机生成）
 * }
 * @returns {
 *   created_count: number,      // 创建成功数量
 *   total_credits_used: number, // 消耗的组积分总额
 *   users: Array<{id, username, password, credits}> // 用户列表
 * }
 * @access Admin / SuperAdmin
 */
router.post('/batch-create',
  requirePermission('user.manage'),
  UserManagementController.batchCreateUsers
);

/**
 * @route GET /api/admin/users/:id
 * @desc 获取用户详情 (包含积分信息)
 * @access Admin / SuperAdmin
 */
router.get('/:id',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.getUserDetail
);

/**
 * @route PUT /api/admin/users/:id
 * @desc 更新用户 (支持分组更新和积分配额)
 * @access Admin / SuperAdmin
 */
router.put('/:id',
  requirePermission('user.manage'),
  canManageUser(),
  restrictFieldsForGroupAdmin(),
  UserManagementController.updateUser
);

/**
 * @route PUT /api/admin/users/:id/password
 * @desc 重置用户密码
 * @access Admin / SuperAdmin
 */
router.put('/:id/password',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.resetUserPassword
);

/**
 * @route DELETE /api/admin/users/:id
 * @desc 删除用户
 * @access Admin / SuperAdmin
 */
router.delete('/:id',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.deleteUser
);

/**
 * @route GET /api/admin/users/:id/model-permissions
 * @desc 获取用户的模型权限
 * @access Admin / SuperAdmin
 */
router.get('/:id/model-permissions',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.getUserModelPermissions
);

/**
 * @route PUT /api/admin/users/:id/model-restrictions
 * @desc 更新用户的模型限制
 * @access Admin / SuperAdmin
 */
router.put('/:id/model-restrictions',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.updateUserModelRestrictions
);

/**
 * @route POST /api/admin/users/:id/remove-from-group
 * @desc 将用户挪出当前组（移到默认组）
 * @access Admin / SuperAdmin
 */
router.post('/:id/remove-from-group',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.removeUserFromGroup
);

/**
 * @route PUT /api/admin/users/:id/expire-date
 * @desc 设置用户账号有效期
 * @access Admin / SuperAdmin
 */
router.put('/:id/expire-date',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.setUserAccountExpireDate
);

/**
 * @route PUT /api/admin/users/:id/extend-expire-date
 * @desc 延长用户账号有效期
 * @access Admin / SuperAdmin
 */
router.put('/:id/extend-expire-date',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.extendUserAccountExpireDate
);

/**
 * @route POST /api/admin/users/:id/sync-expire-date
 * @desc 同步用户有效期到组有效期
 * @access Admin / SuperAdmin
 */
router.post('/:id/sync-expire-date',
  requirePermission('user.manage'),
  canManageUser(),
  UserManagementController.syncUserAccountExpireWithGroup
);

module.exports = router;
