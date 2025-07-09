/**
 * 管理员路由 - 支持用户分组管理和积分管理
 */

const express = require('express');
const AdminController = require('../controllers/adminController');
const { authenticate, requireRole, requirePermission } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// 管理员操作限流配置
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制每个IP最多100个管理请求
  message: {
    success: false,
    message: '管理操作过于频繁，请稍后再试',
    timestamp: new Date().toISOString()
  }
});

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/admin/stats
 * @desc 获取系统统计信息 (包含分组统计和积分统计)
 * @access Admin / SuperAdmin
 */
router.get('/stats',
  adminLimiter,
  requireRole(['admin', 'super_admin']),
  AdminController.getSystemStats
);

/**
 * @route GET /api/admin/users
 * @desc 获取用户列表 (支持分组过滤)
 * @access Admin / SuperAdmin
 */
router.get('/users',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.getUsers
);

/**
 * @route POST /api/admin/users
 * @desc 创建用户 (支持分组设置和积分配额)
 * @access Admin / SuperAdmin
 */
router.post('/users',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.createUser
);

/**
 * @route GET /api/admin/users/:id
 * @desc 获取用户详情 (包含积分信息)
 * @access Admin / SuperAdmin
 */
router.get('/users/:id',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.getUserDetail
);

/**
 * @route PUT /api/admin/users/:id
 * @desc 更新用户 (支持分组更新和积分配额)
 * @access Admin / SuperAdmin
 */
router.put('/users/:id',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.updateUser
);

/**
 * @route DELETE /api/admin/users/:id
 * @desc 删除用户
 * @access Admin / SuperAdmin
 */
router.delete('/users/:id',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.deleteUser
);

// ===== 积分管理路由 (新增核心功能) =====

/**
 * @route GET /api/admin/users/:id/credits
 * @desc 获取用户积分信息
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.get('/users/:id/credits',
  adminLimiter,
  requirePermission('credits.manage'),
  AdminController.getUserCredits
);

/**
 * @route PUT /api/admin/users/:id/credits
 * @desc 设置用户积分配额
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.put('/users/:id/credits',
  adminLimiter,
  requirePermission('credits.manage'),
  AdminController.setUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/add
 * @desc 充值用户积分
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.post('/users/:id/credits/add',
  adminLimiter,
  requirePermission('credits.manage'),
  AdminController.addUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/deduct
 * @desc 扣减用户积分
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.post('/users/:id/credits/deduct',
  adminLimiter,
  requirePermission('credits.manage'),
  AdminController.deductUserCredits
);

/**
 * @route GET /api/admin/users/:id/credits/history
 * @desc 获取用户积分使用历史
 * @access Admin / SuperAdmin with credits.manage permission
 */
router.get('/users/:id/credits/history',
  adminLimiter,
  requirePermission('credits.manage'),
  AdminController.getUserCreditsHistory
);

// ===== 用户分组管理路由 (保持不变) =====

/**
 * @route GET /api/admin/user-groups
 * @desc 获取用户分组列表
 * @access Admin / SuperAdmin
 */
router.get('/user-groups',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.getUserGroups
);

/**
 * @route POST /api/admin/user-groups
 * @desc 创建用户分组
 * @access SuperAdmin
 */
router.post('/user-groups',
  adminLimiter,
  requirePermission('group.manage'),
  AdminController.createUserGroup
);

/**
 * @route PUT /api/admin/user-groups/:id
 * @desc 更新用户分组
 * @access SuperAdmin
 */
router.put('/user-groups/:id',
  adminLimiter,
  requirePermission('group.manage'),
  AdminController.updateUserGroup
);

/**
 * @route DELETE /api/admin/user-groups/:id
 * @desc 删除用户分组
 * @access SuperAdmin
 */
router.delete('/user-groups/:id',
  adminLimiter,
  requirePermission('group.manage'),
  AdminController.deleteUserGroup
);

// ===== AI模型管理路由 (保持不变) =====

/**
 * @route GET /api/admin/models
 * @desc 获取AI模型管理
 * @access SuperAdmin
 */
router.get('/models',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.getAIModels
);

/**
 * @route POST /api/admin/models
 * @desc 创建AI模型配置
 * @access SuperAdmin
 */
router.post('/models',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.createAIModel
);

/**
 * @route PUT /api/admin/models/:id
 * @desc 更新AI模型配置 (支持积分配置)
 * @access SuperAdmin
 */
router.put('/models/:id',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.updateAIModel
);

/**
 * @route POST /api/admin/models/:id/test
 * @desc 测试AI模型连通性
 * @access SuperAdmin
 */
router.post('/models/:id/test',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.testAIModel
);

/**
 * @route DELETE /api/admin/models/:id
 * @desc 删除AI模型配置
 * @access SuperAdmin
 */
router.delete('/models/:id',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.deleteAIModel
);

// ===== 系统模块管理路由 (保持不变) =====

/**
 * @route GET /api/admin/modules
 * @desc 获取系统模块列表
 * @access SuperAdmin
 */
router.get('/modules',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.getModules
);

/**
 * @route POST /api/admin/modules
 * @desc 创建系统模块
 * @access SuperAdmin
 */
router.post('/modules',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.createModule
);

/**
 * @route PUT /api/admin/modules/:id
 * @desc 更新系统模块
 * @access SuperAdmin
 */
router.put('/modules/:id',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.updateModule
);

/**
 * @route DELETE /api/admin/modules/:id
 * @desc 删除系统模块
 * @access SuperAdmin
 */
router.delete('/modules/:id',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.deleteModule
);

/**
 * @route POST /api/admin/modules/:id/health-check
 * @desc 检查模块健康状态
 * @access SuperAdmin
 */
router.post('/modules/:id/health-check',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.checkModuleHealth
);

// ===== 系统设置路由 (包含积分设置) =====

/**
 * @route GET /api/admin/settings
 * @desc 获取系统设置 (包含积分设置)
 * @access SuperAdmin
 */
router.get('/settings',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.getSystemSettings
);

/**
 * @route PUT /api/admin/settings
 * @desc 更新系统设置 (包含积分设置)
 * @access SuperAdmin
 */
router.put('/settings',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.updateSystemSettings
);

module.exports = router;
