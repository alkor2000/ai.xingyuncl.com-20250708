/**
 * 智能应用路由定义
 * 
 * 用户端路由（/api/smart-apps）：
 * - GET    /                    获取已发布的应用列表（含收藏状态）
 * - GET    /categories          获取分类列表和统计
 * - GET    /favorites           获取我的收藏列表
 * - GET    /:id                 获取应用详情
 * - GET    /:id/config          获取应用配置
 * - POST   /:id/use             记录应用使用
 * - POST   /:id/favorite        添加收藏
 * - DELETE /:id/favorite        取消收藏
 * - GET    /:id/conversation    获取或创建会话
 * - POST   /:id/conversation/clear  清空会话消息
 * 
 * 管理端路由（/api/admin/smart-apps）：
 * - GET    /                    获取所有应用列表
 * - GET    /categories          获取分类列表
 * - POST   /categories          创建分类
 * - PUT    /categories/:id      更新分类
 * - DELETE /categories/:id      删除分类
 * - GET    /:id                 获取应用详情
 * - POST   /                    创建新应用
 * - PUT    /:id                 更新应用
 * - DELETE /:id                 删除应用
 * - POST   /:id/toggle-publish  切换发布状态
 * 
 * 版本：v2.2.0
 * 更新：2025-12-30 新增收藏功能路由
 */

const express = require('express');
const { SmartAppAdminController, SmartAppUserController } = require('../controllers/SmartAppController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');

// ==================== 用户端路由 ====================
const router = express.Router();

/**
 * @route   GET /api/smart-apps
 * @desc    获取已发布的智能应用列表（含收藏状态）
 * @access  需要登录
 */
router.get('/', authenticate, SmartAppUserController.list);

/**
 * @route   GET /api/smart-apps/categories
 * @desc    获取分类列表和统计信息
 * @access  需要登录
 */
router.get('/categories', authenticate, SmartAppUserController.getCategories);

/**
 * @route   GET /api/smart-apps/favorites
 * @desc    获取我的收藏列表
 * @access  需要登录
 */
router.get('/favorites', authenticate, SmartAppUserController.getFavorites);

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

/**
 * @route   POST /api/smart-apps/:id/favorite
 * @desc    添加收藏
 * @access  需要登录
 */
router.post('/:id/favorite', authenticate, SmartAppUserController.addFavorite);

/**
 * @route   DELETE /api/smart-apps/:id/favorite
 * @desc    取消收藏
 * @access  需要登录
 */
router.delete('/:id/favorite', authenticate, SmartAppUserController.removeFavorite);

/**
 * @route   GET /api/smart-apps/:id/conversation
 * @desc    获取或创建智能应用专属会话
 * @access  需要登录
 */
router.get('/:id/conversation', authenticate, SmartAppUserController.getOrCreateConversation);

/**
 * @route   POST /api/smart-apps/:id/conversation/clear
 * @desc    清空智能应用会话消息
 * @access  需要登录
 */
router.post('/:id/conversation/clear', authenticate, SmartAppUserController.clearConversation);


// ==================== 管理端路由 ====================
const adminRouter = express.Router();

adminRouter.get('/', authenticate, requireSuperAdmin(), SmartAppAdminController.list);
adminRouter.get('/categories', authenticate, requireSuperAdmin(), SmartAppAdminController.getCategories);
adminRouter.post('/categories', authenticate, requireSuperAdmin(), SmartAppAdminController.createCategory);
adminRouter.put('/categories/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.updateCategory);
adminRouter.delete('/categories/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.deleteCategory);
adminRouter.get('/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.getById);
adminRouter.post('/', authenticate, requireSuperAdmin(), SmartAppAdminController.create);
adminRouter.put('/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.update);
adminRouter.delete('/:id', authenticate, requireSuperAdmin(), SmartAppAdminController.delete);
adminRouter.post('/:id/toggle-publish', authenticate, requireSuperAdmin(), SmartAppAdminController.togglePublish);


// ==================== 导出路由 ====================
module.exports = router;
module.exports.adminRouter = adminRouter;
