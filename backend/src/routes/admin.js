/**
 * 管理员路由
 */

const express = require('express');
const AdminController = require('../controllers/adminController');
const { authenticate, requireRole, requirePermission } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// 管理员操作限流配置
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每15分钟最多100次操作
  message: {
    success: false,
    code: 429,
    message: '管理操作频率过高，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  }
});

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/admin/stats
 * @desc 获取系统统计信息
 * @access Admin / SuperAdmin
 */
router.get('/stats',
  adminLimiter,
  requireRole(['admin', 'super_admin']),
  AdminController.getSystemStats
);

/**
 * @route GET /api/admin/users
 * @desc 获取用户列表
 * @access Admin / SuperAdmin
 */
router.get('/users',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.getUsers
);

/**
 * @route POST /api/admin/users
 * @desc 创建用户
 * @access Admin / SuperAdmin
 */
router.post('/users',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.createUser
);

/**
 * @route GET /api/admin/users/:id
 * @desc 获取用户详情
 * @access Admin / SuperAdmin
 */
router.get('/users/:id',
  adminLimiter,
  requirePermission('user.manage'),
  AdminController.getUserDetail
);

/**
 * @route PUT /api/admin/users/:id
 * @desc 更新用户
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
 * @desc 更新AI模型配置
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

/**
 * @route GET /api/admin/settings
 * @desc 获取系统设置
 * @access SuperAdmin
 */
router.get('/settings',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.getSystemSettings
);

/**
 * @route PUT /api/admin/settings
 * @desc 更新系统设置
 * @access SuperAdmin
 */
router.put('/settings',
  adminLimiter,
  requirePermission('system.all'),
  AdminController.updateSystemSettings
);

module.exports = router;
