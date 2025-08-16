/**
 * 图像生成路由
 */
const express = require('express');
const router = express.Router();
const { ImageController, ImageAdminController } = require('../controllers/imageController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');

// ========== 用户端路由 ==========

// 所有路由需要登录
router.use(authenticate);

// 获取可用的图像模型列表
router.get('/models', ImageController.getModels);

// 生成图片（支持同步和异步模型）
router.post('/generate', ImageController.generateImage);

// Midjourney特定路由
router.post('/midjourney/action', ImageController.midjourneyAction); // U/V/Reroll操作
router.get('/midjourney/task/:task_id', ImageController.getMidjourneyTaskStatus); // 查询任务状态
router.get('/midjourney/tasks', ImageController.getMidjourneyTasks); // 获取任务列表

// 获取用户的生成历史
router.get('/history', ImageController.getUserHistory);

// 获取用户统计信息
router.get('/stats', ImageController.getUserStats);

// 获取单个生成记录详情
router.get('/generation/:id', ImageController.getGeneration);

// 删除生成记录
router.delete('/generation/:id', ImageController.deleteGeneration);

// 批量删除生成记录
router.post('/generations/batch-delete', ImageController.batchDeleteGenerations);

// 切换收藏状态
router.post('/generation/:id/favorite', ImageController.toggleFavorite);

// 切换公开状态
router.post('/generation/:id/public', ImageController.togglePublic);

// 获取公开画廊
router.get('/gallery', ImageController.getPublicGallery);

// Webhook接收（用于Midjourney回调，不需要认证）
router.post('/webhook/midjourney', ImageController.webhook);

// ========== 管理端路由 ==========

// 需要超级管理员权限
router.use('/admin', requireSuperAdmin());

// 获取所有图像模型（包含未激活的）
router.get('/admin/models', ImageAdminController.getAllModels);

// 创建图像模型
router.post('/admin/models', ImageAdminController.createModel);

// 更新图像模型
router.put('/admin/models/:id', ImageAdminController.updateModel);

// 删除图像模型
router.delete('/admin/models/:id', ImageAdminController.deleteModel);

// 切换模型状态
router.patch('/admin/models/:id/toggle', ImageAdminController.toggleModelStatus);

module.exports = router;
