/**
 * 视频生成路由
 * 
 * v1.1 修复：首帧图片上传兼容多图上传中间件
 *   uploadMiddleware.uploadImage 在多图上传v2.0后改为 multer.array('image', 5)
 *   处理结果在 req.files（数组）而非 req.file（单个）
 *   本路由只需要一张图片，从 req.files[0] 取第一张
 */
const express = require('express');
const router = express.Router();
const { VideoController, VideoAdminController } = require('../controllers/videoController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');

/* ========== 用户端路由 ========== */

/* 所有路由需要登录 */
router.use(authenticate);
router.use(require('./videoSafety'));

/* 获取可用的视频模型列表 */
router.get('/models', VideoController.getModels);

/**
 * 上传首帧/尾帧图片
 * v1.1 修复：uploadImage 是 multer.array('image', 5)，结果在 req.files 数组中
 *   视频首帧只需要一张图片，取 req.files[0]
 */
const frameUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
router.post('/upload-frame', frameUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传图片文件' });
    const data = await require('../services/imageSafetyService').uploadReference(req.user.id, req.file.buffer);
    res.json({ success: true, data });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.statusCode ? e.message : '参考帧审核失败' }); }
});

/* 提交视频生成任务 */
router.post('/generate', VideoController.generateVideo);

/* 查询任务状态 */
router.get('/task/:task_id', VideoController.getTaskStatus);

/* 获取用户的生成历史 */
router.get('/history', VideoController.getUserHistory);

/* 获取用户统计信息 */
router.get('/stats', VideoController.getUserStats);

/* 获取单个生成记录详情 */
router.get('/generation/:id', VideoController.getGeneration);

/* 删除生成记录 */
router.delete('/generation/:id', VideoController.deleteGeneration);

/* 批量删除生成记录 */
router.post('/generations/batch-delete', VideoController.batchDeleteGenerations);

/* 切换收藏状态 */
router.post('/generation/:id/favorite', VideoController.toggleFavorite);

/* 切换公开状态 */
router.post('/generation/:id/public', VideoController.togglePublic);

/* 获取公开画廊 */
router.get('/gallery', VideoController.getPublicGallery);

/* ========== 管理端路由 ========== */

/* 需要超级管理员权限 */
router.use('/admin', requireSuperAdmin());

/* 获取所有视频模型（包含未激活的） */
router.get('/admin/models', VideoAdminController.getAllModels);

/* 创建视频模型 */
router.post('/admin/models', VideoAdminController.createModel);

/* 更新视频模型 */
router.put('/admin/models/:id', VideoAdminController.updateModel);

/* 删除视频模型 */
router.delete('/admin/models/:id', VideoAdminController.deleteModel);

/* 切换模型状态 */
router.patch('/admin/models/:id/toggle', VideoAdminController.toggleModelStatus);

module.exports = router;
