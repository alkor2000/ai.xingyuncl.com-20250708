/**
 * 管理员路由聚合器 - 使用基于角色的权限中间件、动态速率限制和缓存统计
 */

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { 
  canViewSystem, 
  canManageSystem, 
  canViewAIModels, 
  canManageAIModels,
  canViewCredits, 
  canManageCredits 
} = require('../middleware/permissions');
const { uploadSiteLogo } = require('../middleware/systemUploadMiddleware');
const rateLimitService = require('../services/rateLimitService');

// 导入子路由
const userRoutes = require('./admin/userRoutes');
const creditsRoutes = require('./admin/creditsRoutes');
const groupRoutes = require('./admin/groupRoutes');
const modelRoutes = require('./admin/modelRoutes');
const statsRoutes = require('./admin/statsRoutes');
const moduleRoutes = require('./admin/moduleRoutes'); // 新增模块路由
const apiServiceRoutes = require('./admin/apiServiceRoutes'); // 新增API服务路由
const systemPromptRoutes = require('./admin/systemPromptRoutes'); // 系统提示词路由
const usageLogRoutes = require('./admin/usageLogRoutes'); // 使用记录路由
const ossRoutes = require('./admin/ossRoutes'); // OSS配置路由
const storageCreditRoutes = require('./admin/storageCreditRoutes'); // 存储积分配置路由
const userTagRoutes = require('./admin/userTagRoutes'); // 用户标签路由

// 导入控制器（用于积分路由）
const UserCreditsController = require('../controllers/admin/UserCreditsController');
const SystemStatsController = require('../controllers/admin/SystemStatsController');

const router = express.Router();

// 创建动态速率限制中间件
const dynamicAdminReadLimit = async (req, res, next) => {
  // 只对GET请求应用读限制
  if (req.method !== 'GET') {
    return next();
  }
  
  try {
    const limiter = await rateLimitService.getLimiter('adminRead');
    limiter(req, res, next);
  } catch (error) {
    console.error('获取管理读操作速率限制器失败:', error);
    next();
  }
};

const dynamicAdminWriteLimit = async (req, res, next) => {
  // 只对非GET请求应用写限制
  if (req.method === 'GET') {
    return next();
  }
  
  try {
    const limiter = await rateLimitService.getLimiter('adminWrite');
    limiter(req, res, next);
  } catch (error) {
    console.error('获取管理写操作速率限制器失败:', error);
    next();
  }
};

// 所有路由都需要认证
router.use(authenticate);

// 应用动态分层限流中间件
router.use(dynamicAdminReadLimit);  // 读操作限流
router.use(dynamicAdminWriteLimit); // 写操作限流

// ===== 路由挂载 =====

// 用户管理路由 - /api/admin/users/*
router.use('/users', userRoutes);

// 用户分组管理路由 - /api/admin/user-groups/*
router.use('/user-groups', groupRoutes);

// 用户标签管理路由 - /api/admin/user-tags/*
router.use('/user-tags', userTagRoutes);

// AI模型管理路由 - /api/admin/models/*
router.use('/models', modelRoutes);

// 系统模块管理路由 - /api/admin/modules/*
router.use('/modules', moduleRoutes);

// API服务管理路由 - /api/admin/api-services/*
router.use('/api-services', apiServiceRoutes);

// 系统提示词管理路由 - /api/admin/system-prompts/*
router.use('/system-prompts', systemPromptRoutes);

// 使用记录路由 - /api/admin/usage-logs/*
router.use('/usage-logs', usageLogRoutes);

// OSS配置管理路由 - /api/admin/oss/*
router.use('/oss', ossRoutes);

// 存储积分配置路由 - 修复：使用复数形式匹配前端 /api/admin/storage-credits/*
router.use('/storage-credits', storageCreditRoutes);

// 系统统计路由 - /api/admin/stats
router.use('/stats', statsRoutes);

// ===== 缓存管理路由（新增）=====
// 缓存统计
router.get('/cache/stats',
  canManageSystem(), // 只有超级管理员可以查看
  SystemStatsController.getCacheStats
);

// 清除缓存
router.post('/cache/clear',
  canManageSystem(), // 只有超级管理员可以清除
  SystemStatsController.clearCache
);

// ===== 系统设置路由 =====
// 系统设置路由 - 保持原路径 /api/admin/settings
router.get('/settings',
  canManageSystem(), // 超级管理员和组管理员都可以查看
  SystemStatsController.getSystemSettings
);

router.put('/settings',
  canManageSystem(), // 只有超级管理员可以修改
  SystemStatsController.updateSystemSettings
);

// 速率限制配置路由（新增）
router.get('/settings/rate-limit',
  canManageSystem(), // 只有超级管理员可以查看
  SystemStatsController.getRateLimitSettings
);

router.put('/settings/rate-limit',
  canManageSystem(), // 只有超级管理员可以修改
  SystemStatsController.updateRateLimitSettings
);

// 邮件设置路由
router.get('/settings/email',
  canManageSystem(), // 只有超级管理员可以查看
  SystemStatsController.getEmailSettings
);

router.put('/settings/email',
  canManageSystem(), // 只有超级管理员可以修改
  SystemStatsController.updateEmailSettings
);

router.post('/settings/email/test',
  canManageSystem(), // 只有超级管理员可以测试
  SystemStatsController.testEmailSend
);

// ===== SSO配置路由（新增）=====
// 获取SSO配置
router.get('/settings/sso',
  canManageSystem(), // 只有超级管理员可以查看
  SystemStatsController.getSSOSettings
);

// 更新SSO配置
router.put('/settings/sso',
  canManageSystem(), // 只有超级管理员可以修改
  SystemStatsController.updateSSOSettings
);

// 生成新的SSO密钥
router.post('/settings/sso/generate-secret',
  canManageSystem(), // 只有超级管理员可以生成
  SystemStatsController.generateSSOSecret
);

// 站点Logo上传路由
router.post('/settings/upload-logo',
  canManageSystem(), // 只有超级管理员可以上传
  uploadSiteLogo,
  SystemStatsController.uploadSiteLogo
);

// 系统公告路由
router.get('/announcement',
  // 所有认证用户都可以查看公告
  SystemStatsController.getSystemAnnouncement
);

router.put('/announcement',
  canManageSystem(), // 只有超级管理员可以修改
  SystemStatsController.updateSystemAnnouncement
);

// 自定义首页配置路由
router.get('/settings/custom-homepage',
  canManageSystem(), // 超级管理员和组管理员都可以查看
  SystemStatsController.getCustomHomepage
);

router.put('/settings/custom-homepage',
  canManageSystem(), // 只有超级管理员可以修改
  SystemStatsController.updateCustomHomepage
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
