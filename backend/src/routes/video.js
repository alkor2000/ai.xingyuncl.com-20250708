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
const { uploadImage } = require('../middleware/uploadMiddleware');
const ossService = require('../services/ossService');
const path = require('path');
const logger = require('../utils/logger');

/* ========== 用户端路由 ========== */

/* 所有路由需要登录 */
router.use(authenticate);

/* 获取可用的视频模型列表 */
router.get('/models', VideoController.getModels);

/**
 * 上传首帧/尾帧图片
 * v1.1 修复：uploadImage 是 multer.array('image', 5)，结果在 req.files 数组中
 *   视频首帧只需要一张图片，取 req.files[0]
 */
router.post('/upload-frame', uploadImage, async (req, res) => {
  try {
    /* v1.1 修复：兼容 req.file（单图）和 req.files（多图中间件） */
    const uploadedFile = req.file || (req.files && req.files[0]);
    
    if (!uploadedFile) {
      return res.status(400).json({
        success: false,
        message: '请上传图片文件'
      });
    }

    const userId = req.user.id;
    
    /* 初始化OSS服务 */
    await ossService.initialize();
    
    /* 读取文件 */
    const fs = require('fs').promises;
    const fileBuffer = await fs.readFile(uploadedFile.path);
    
    /* 生成OSS key */
    const dateFolder = new Date().toISOString().slice(0, 7); // YYYY-MM
    const timestamp = Date.now();
    const crypto = require('crypto');
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(uploadedFile.originalname);
    const fileName = `frame_${timestamp}_${random}${ext}`;
    const ossKey = `video-frames/${userId}/${dateFolder}/${fileName}`;
    
    /* 上传到OSS */
    const uploadResult = await ossService.uploadFile(fileBuffer, ossKey, {
      headers: {
        'Content-Type': uploadedFile.mimetype,
        'Content-Disposition': `inline; filename="${fileName}"`
      }
    });
    
    /* 删除临时文件 */
    await fs.unlink(uploadedFile.path);
    
    logger.info('首帧图片上传成功', {
      userId,
      ossKey,
      url: uploadResult.url
    });
    
    return res.json({
      success: true,
      data: {
        url: uploadResult.url,
        ossKey: ossKey,
        fileName: uploadedFile.originalname,
        size: uploadedFile.size
      },
      message: '图片上传成功'
    });
    
  } catch (error) {
    logger.error('上传首帧图片失败:', error);
    
    /* 清理临时文件 */
    const uploadedFile = req.file || (req.files && req.files[0]);
    if (uploadedFile && uploadedFile.path) {
      const fs = require('fs').promises;
      try {
        await fs.unlink(uploadedFile.path);
      } catch (e) {
        /* 忽略删除错误 */
      }
    }
    
    return res.status(500).json({
      success: false,
      message: error.message || '图片上传失败'
    });
  }
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
