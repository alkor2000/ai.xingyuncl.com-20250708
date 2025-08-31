/**
 * 视频生成路由
 */
const express = require('express');
const router = express.Router();
const { VideoController, VideoAdminController } = require('../controllers/videoController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');

// ========== 用户端路由 ==========

// 所有路由需要登录
router.use(authenticate);

// 获取可用的视频模型列表
router.get('/models', VideoController.getModels);

// 提交视频生成任务
router.post('/generate', VideoController.generateVideo);

// 查询任务状态
router.get('/task/:task_id', VideoController.getTaskStatus);

// 获取用户的生成历史
router.get('/history', VideoController.getUserHistory);

// 获取用户统计信息
router.get('/stats', VideoController.getUserStats);

// 获取单个生成记录详情
router.get('/generation/:id', VideoController.getGeneration);

// 删除生成记录
router.delete('/generation/:id', VideoController.deleteGeneration);

// 批量删除生成记录
router.post('/generations/batch-delete', VideoController.batchDeleteGenerations);

// 切换收藏状态
router.post('/generation/:id/favorite', VideoController.toggleFavorite);

// 切换公开状态
router.post('/generation/:id/public', VideoController.togglePublic);

// 获取公开画廊
router.get('/gallery', VideoController.getPublicGallery);

// ========== 管理端路由 ==========

// 需要超级管理员权限
router.use('/admin', requireSuperAdmin());

// 获取所有视频模型（包含未激活的）
router.get('/admin/models', VideoAdminController.getAllModels);

// 创建视频模型
router.post('/admin/models', VideoAdminController.createModel);

// 更新视频模型
router.put('/admin/models/:id', VideoAdminController.updateModel);

// 删除视频模型
router.delete('/admin/models/:id', VideoAdminController.deleteModel);

// 切换模型状态
router.patch('/admin/models/:id/toggle', VideoAdminController.toggleModelStatus);

module.exports = router;
