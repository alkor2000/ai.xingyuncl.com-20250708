/**
 * 管理员路由聚合器 - 使用优化的权限中间件
 */

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { canViewCredits, canManageCredits } = require('../middleware/permissions');
const rateLimit = require('express-rate-limit');

// 导入子路由
const userRoutes = require('./admin/userRoutes');
const creditsRoutes = require('./admin/creditsRoutes');
const groupRoutes = require('./admin/groupRoutes');
const modelRoutes = require('./admin/modelRoutes');
const statsRoutes = require('./admin/statsRoutes');

// 导入控制器（用于积分路由）
const UserCreditsController = require('../controllers/admin/UserCreditsController');
const SystemStatsController = require('../controllers/admin/SystemStatsController');

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

// 应用限流中间件
router.use(adminLimiter);

// ===== 路由挂载 =====

// 用户管理路由 - /api/admin/users/*
router.use('/users', userRoutes);

// 用户分组管理路由 - /api/admin/user-groups/*
router.use('/user-groups', groupRoutes);

// AI模型管理路由 - /api/admin/models/*
router.use('/models', modelRoutes);

// 系统统计路由 - /api/admin/stats
router.use('/stats', statsRoutes);

// 系统设置路由 - 保持原路径 /api/admin/settings
router.get('/settings',
  require('../middleware/permissions').canManageSystem(),
  SystemStatsController.getSystemSettings
);

router.put('/settings',
  require('../middleware/permissions').canManageSystem(),
  SystemStatsController.updateSystemSettings
);

// ===== 特殊处理：积分相关路由 =====
// 由于积分路由路径包含 /users/:id/credits，需要在这里统一处理

/**
 * @route GET /api/admin/users/:id/credits
 * @desc 获取用户积分信息
 */
router.get('/users/:id/credits',
  canViewCredits(),
  UserCreditsController.getUserCredits
);

/**
 * @route PUT /api/admin/users/:id/credits
 * @desc 设置用户积分配额
 */
router.put('/users/:id/credits',
  canManageCredits(),
  UserCreditsController.setUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/add
 * @desc 充值用户积分
 */
router.post('/users/:id/credits/add',
  canManageCredits(),
  UserCreditsController.addUserCredits
);

/**
 * @route POST /api/admin/users/:id/credits/deduct
 * @desc 扣减用户积分
 */
router.post('/users/:id/credits/deduct',
  canManageCredits(),
  UserCreditsController.deductUserCredits
);

/**
 * @route GET /api/admin/users/:id/credits/history
 * @desc 获取用户积分使用历史
 */
router.get('/users/:id/credits/history',
  canViewCredits(),
  UserCreditsController.getUserCreditsHistory
);

/**
 * @route PUT /api/admin/users/:id/credits/expire
 * @desc 设置用户积分有效期
 */
router.put('/users/:id/credits/expire',
  canManageCredits(),
  UserCreditsController.setUserCreditsExpire
);

module.exports = router;
