/**
 * 智能应用路由定义
 * 
 * 管理端路由（/api/admin/smart-apps）：
 * - GET    /                    获取所有应用列表
 * - GET    /categories          获取分类列表
 * - GET    /:id                 获取应用详情
 * - POST   /                    创建新应用
 * - PUT    /:id                 更新应用
 * - DELETE /:id                 删除应用
 * - POST   /:id/toggle-publish  切换发布状态
 * 
 * 用户端路由（/api/smart-apps）：
 * - GET    /                    获取已发布的应用列表
 * - GET    /categories          获取分类列表和统计
 * - GET    /:id                 获取应用详情
 * - GET    /:id/config          获取应用配置（用于创建会话）
 * - POST   /:id/use             记录应用使用（新增）
 * 
 * 版本：v1.1.0
 * 更新：2025-12-30 添加use端点
 */

const express = require('express');
const { SmartAppAdminController, SmartAppUserController } = require('../controllers/SmartAppController');
const { authenticate } = require('../middleware/authMiddleware');
// 导入超级管理员权限中间件（工厂函数）
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');

// ==================== 用户端路由 ====================
const router = express.Router();

/**
 * @route   GET /api/smart-apps
 * @desc    获取已发布的智能应用列表
 * @access  需要登录
 * @query   page, limit, category, keyword
 */
router.get('/', authenticate, SmartAppUserController.list);

/**
 * @route   GET /api/smart-apps/categories
 * @desc    获取分类列表和统计信息
 * @access  需要登录
 */
router.get('/categories', authenticate, SmartAppUserController.getCategories);

/**
 * @route   GET /api/smart-apps/:id
 * @desc    获取智能应用详情
 * @access  需要登录
 */
router.get('/:id', authenticate, SmartAppUserController.getById);

/**
 * @route   GET /api/smart-apps/:id/config
 * @desc    获取应用配置（用于创建会话）
 * @access  需要登录
 */
router.get('/:id/config', authenticate, SmartAppUserController.getConfig);

/**
 * @route   POST /api/smart-apps/:id/use
 * @desc    记录应用使用次数
 * @access  需要登录
 */
router.post('/:id/use', authenticate, SmartAppUserController.recordUse);


// ==================== 管理端路由 ====================
const adminRouter = express.Router();

/**
 * @route   GET /api/admin/smart-apps
 * @desc    获取所有智能应用列表（包含未发布）
 * @access  超级管理员
 * @query   page, limit, category, is_published, keyword
 */
adminRouter.get('/', authenticate, requireSuperAdmin(), SmartAppAdminController.list);

/**
 * @route   GET /api/admin/smart-apps/categories
 * @desc    获取分类列表
 * @access  超级管理员
 */
adminRouter.get('/categories', authenticate, requireSuperAdmin(), SmartAppAdminController.getCategories);

/**
 * @route   GET /api/admin/smart-apps/:id
 * @desc    获取智能应用详情（包含系统提示词）
 * @access  超级管理员
 */
adminRouter.get('/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.getById);

/**
 * @route   POST /api/admin/smart-apps
 * @desc    创建新智能应用
 * @access  超级管理员
 */
adminRouter.post('/', authenticate, requireSuperAdmin(), SmartAppAdminController.create);

/**
 * @route   PUT /api/admin/smart-apps/:id
 * @desc    更新智能应用
 * @access  超级管理员
 */
adminRouter.put('/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.update);

/**
 * @route   DELETE /api/admin/smart-apps/:id
 * @desc    删除智能应用
 * @access  超级管理员
 */
adminRouter.delete('/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.delete);

/**
 * @route   POST /api/admin/smart-apps/:id/toggle-publish
 * @desc    切换应用发布状态
 * @access  超级管理员
 */
adminRouter.post('/:id/toggle-publish', authenticate, requireSuperAdmin(), SmartAppAdminController.togglePublish);


// ==================== 导出路由 ====================
// 用户端路由作为默认导出
module.exports = router;
// 管理端路由作为命名导出
module.exports.adminRouter = adminRouter;
