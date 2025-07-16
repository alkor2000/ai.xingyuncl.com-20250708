/**
 * 文件上传中间件
 * 处理图片上传，支持对话中的图片
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');

// 确保上传目录存在
const ensureUploadDir = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    logger.info('创建上传目录', { dirPath });
  }
};

// 生成唯一文件名
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `${timestamp}-${random}${ext}`;
};

// 配置存储
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadBase = '/var/www/ai-platform/uploads';
    let uploadDir = uploadBase;
    
    // 根据文件类型分类存储
    if (file.mimetype.startsWith('image/')) {
      uploadDir = path.join(uploadBase, 'chat-images', new Date().toISOString().slice(0, 7)); // 按年月分目录
    } else {
      uploadDir = path.join(uploadBase, 'others');
    }
    
    try {
      await ensureUploadDir(uploadDir);
      cb(null, uploadDir);
    } catch (error) {
      logger.error('创建上传目录失败', { error: error.message });
      cb(error);
    }
  },
  
  filename: (req, file, cb) => {
    const fileName = generateFileName(file.originalname);
    cb(null, fileName);
  }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
  // 支持的图片格式
  const allowedMimes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
};

// 创建上传中间件
const uploadImage = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1 // 单次只允许上传一个文件
  }
}).single('image');

// 处理上传错误的中间件包装
const handleUpload = (req, res, next) => {
  uploadImage(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('Multer上传错误', { error: err.message });
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: '文件大小不能超过10MB'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: `上传错误: ${err.message}`
      });
    } else if (err) {
      logger.error('文件上传错误', { error: err.message });
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    // 没有错误，继续处理
    next();
  });
};

// 导出中间件
module.exports = {
  uploadImage: handleUpload,
  
  // 工具函数：获取文件的公开访问URL
  getFileUrl: (filePath) => {
    // 将本地路径转换为URL路径
    const relativePath = filePath.replace('/var/www/ai-platform/', '');
    return `/${relativePath}`;
  },
  
  // 工具函数：删除上传的文件
  deleteFile: async (filePath) => {
    try {
      await fs.unlink(filePath);
      logger.info('文件删除成功', { filePath });
    } catch (error) {
      logger.error('文件删除失败', { filePath, error: error.message });
    }
  }
};
