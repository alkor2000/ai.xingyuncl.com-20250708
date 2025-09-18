/**
 * OCR路由
 * 处理OCR相关的API请求
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const OcrController = require('../controllers/OcrController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');

// 配置multer用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB限制
    files: 10 // 批量最多10个文件
  },
  fileFilter: (req, file, cb) => {
    // 支持的文件类型
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'application/pdf'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  }
});

// 所有路由需要认证
router.use(authenticate);

// 获取OCR配置
router.get('/config', OcrController.getConfig);

// 处理单个图片OCR
router.post('/process-image', upload.single('image'), OcrController.processImage);

// 处理PDF OCR
router.post('/process-pdf', upload.single('pdf'), OcrController.processPDF);

// 批量处理文件
router.post('/process-batch', upload.array('files', 10), OcrController.processBatch);

// 获取任务详情
router.get('/task/:id', OcrController.getTask);

// 获取任务历史
router.get('/tasks', OcrController.getTasks);

// 管理员路由
router.put('/admin/config', requireSuperAdmin(), OcrController.updateConfig);

module.exports = router;
