/**
 * 公开文件上传中间件
 */

const multer = require('multer');
const logger = require('../utils/logger');

// 内存存储，准备上传到OSS
const storage = multer.memoryStorage();

// 文件过滤器
const fileFilter = (req, file, cb) => {
  // 支持的文件类型
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
};

// 创建上传中间件
const uploadBusinessLicense = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  }
}).single('file');

// 处理上传错误的中间件包装
const handleBusinessLicenseUpload = (req, res, next) => {
  uploadBusinessLicense(req, res, (err) => {
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
    
    next();
  });
};

module.exports = {
  uploadBusinessLicense: handleBusinessLicenseUpload
};
