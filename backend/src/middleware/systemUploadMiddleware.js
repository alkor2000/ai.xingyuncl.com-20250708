/**
 * 系统文件上传中间件
 * 处理站点Logo等系统级文件上传
 * 修改：使用配置文件路径，支持Docker部署
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

// 确保上传目录存在
const ensureUploadDir = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    logger.info('创建系统上传目录', { dirPath });
  }
};

// 生成唯一文件名
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `logo-${timestamp}-${random}${ext}`;
};

// 配置存储
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // 使用配置中的系统上传目录，支持容器化部署
    const uploadDir = config.storage.paths.system;
    
    try {
      await ensureUploadDir(uploadDir);
      logger.debug('使用系统上传目录', { uploadDir });
      cb(null, uploadDir);
    } catch (error) {
      logger.error('创建系统上传目录失败', { 
        uploadDir,
        error: error.message 
      });
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
    'image/svg+xml'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
};

// 创建上传中间件
const uploadSiteLogo = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
    files: 1
  }
}).single('logo');

// 处理上传错误的中间件包装
const handleLogoUpload = (req, res, next) => {
  uploadSiteLogo(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('Multer上传错误', { error: err.message });
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Logo文件大小不能超过2MB'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: `上传错误: ${err.message}`
      });
    } else if (err) {
      logger.error('Logo上传错误', { error: err.message });
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    next();
  });
};

module.exports = {
  uploadSiteLogo: handleLogoUpload
};
