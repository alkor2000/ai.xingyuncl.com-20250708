/**
 * 文件路由
 */

const express = require('express');
const FileController = require('../controllers/fileController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// 文件上传限流配置
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 20, // 每15分钟最多20次上传
  message: {
    success: false,
    code: 429,
    message: '文件上传频率过高，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  }
});

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route POST /api/files/upload
 * @desc 上传文件
 * @access Private
 */
router.post('/upload',
  uploadLimiter,
  requirePermission('file.upload'),
  FileController.getUploadMiddleware(),
  FileController.uploadFiles
);

/**
 * @route GET /api/files
 * @desc 获取用户文件列表
 * @access Private
 */
router.get('/',
  requirePermission('file.upload'),
  FileController.getUserFiles
);

/**
 * @route GET /api/files/:id
 * @desc 获取文件信息
 * @access Private
 */
router.get('/:id',
  requirePermission('file.upload'),
  FileController.getFileInfo
);

/**
 * @route DELETE /api/files/:id
 * @desc 删除文件
 * @access Private
 */
router.delete('/:id',
  requirePermission('file.upload'),
  FileController.deleteFile
);

module.exports = router;
