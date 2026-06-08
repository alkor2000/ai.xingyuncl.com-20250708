/**
 * 用户管理路由 - 使用优化的权限中间件
 * 
 * 功能包含：
 * - 用户CRUD操作
 * - 账号有效期管理
 * - 模型权限管理
 * - 批量创建用户（v1.1）
 * - 学校批量导入与按组导出（v1.2 新增）
 *
 * 更新记录：
 * - v1.1: 新增 POST /batch-create 批量创建用户路由
 * - v1.2 (2026-05-09):
 *   * 新增 GET  /school-import/template       下载学校导入模板
 *   * 新增 POST /school-import/preview        预览导入校验
 *   * 新增 POST /school-import/execute        执行批量导入
 *   * 新增 GET  /export-by-group/:id          按用户组导出用户为 Excel
 *   注意：因为本路由在 app.js 中以 /admin/users 挂载，所以学校导入路由
 *        最终路径为 /admin/users/school-import/*，按组导出路径为
 *        /admin/users/export-by-group/:id
 * - v1.3 (2026-06-08) 学校导入异步化：
 *   * 新增 GET  /school-import/execute/status/:taskId  查询导入任务进度/结果
 *     （配合 execute 改为"提交任务 → 后台异步执行 → 前端轮询"模式，规避大批量 HTTP 超时）
 *     该路由为 GET 无文件上传，不挂 multer 中间件
 */
const express = require('express');
const UserManagementController = require('../../controllers/admin/UserManagementController');
const SchoolImportController = require('../../controllers/admin/SchoolImportController');
const { requirePermission } = require('../../middleware/authMiddleware');
const { canManageUser, canCreateUser, restrictFieldsForGroupAdmin } = require('../../middleware/permissions');
const { requireSuperAdmin } = require('../../middleware/permissions/superAdminMiddleware');
const router = express.Router();

// ============================================================
// 学校批量导入相关路由（必须放在 /:id 之前避免参数冲突）
// 全部要求 super_admin 权限
// ============================================================

/**
 * @route GET /api/admin/users/school-import/template
 * @desc 下载学校批量导入 Excel 模板
 * @access SuperAdmin
 */
router.get('/school-import/template',
  requireSuperAdmin(),
  SchoolImportController.downloadTemplate
);

/**
 * @route POST /api/admin/users/school-import/preview
 * @desc 预览学校批量导入（不入库）
 * @form  file: <Excel 文件>
 * @access SuperAdmin
 */
router.post('/school-import/preview',
  requireSuperAdmin(),
  SchoolImportController.uploadMiddleware,
  SchoolImportController.handleMulterError,
  SchoolImportController.previewImport
);

/**
 * @route POST /api/admin/users/school-import/execute
 * @desc 提交学校批量导入异步任务（立即返回 task_id，后台执行）
 * @form  file: <Excel 文件>
 * @access SuperAdmin
 */
router.post('/school-import/execute',
  requireSuperAdmin(),
  SchoolImportController.uploadMiddleware,
  SchoolImportController.handleMulterError,
  SchoolImportController.executeImport
);

/**
 * @route GET /api/admin/users/school-import/execute/status/:taskId
 * @desc 查询学校批量导入任务的进度与结果（v1.3 新增，前端轮询用）
 * @access SuperAdmin
 * @note  必须放在 POST /school-import/execute 之后、用户 /:id 路由之前
 *        GET 请求无文件上传，不挂 multer 中间件
 */
router.get('/school-import/execute/status/:taskId',
  requireSuperAdmin(),
  SchoolImportController.getImportStatus
);

/**
 * @route GET /api/admin/users/export-by-group/:id
 * @desc 按用户组导出全部用户为 Excel
 * @access SuperAdmin
 */
router.get('/export-by-group/:id',
  requireSuperAdmin(),
  SchoolImportController.exportGroupUsers
);

// ============================================================
// 原有用户管理路由
// ============================================================

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
 * @desc 批量创建用户（v1.1）
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
