/**
 * 文档上传中间件
 * 处理文档上传，支持PDF、Word、TXT等格式
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
    logger.info('创建文档上传目录', { dirPath });
  }
};

// 生成唯一文件名
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `doc_${timestamp}_${random}${ext}`;
};

// 配置存储
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // 使用配置中的上传目录
    const uploadBase = config.upload.uploadDir;
    // 文档存储在documents目录，按年月分类
    const uploadDir = path.join(uploadBase, 'documents', new Date().toISOString().slice(0, 7));
    
    try {
      await ensureUploadDir(uploadDir);
      cb(null, uploadDir);
    } catch (error) {
      logger.error('创建文档上传目录失败', { error: error.message });
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
  // 支持的文档格式
  const allowedMimes = [
    // PDF
    'application/pdf',
    // Word文档
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // 纯文本
    'text/plain',
    'text/csv',
    'text/html',
    'text/markdown',
    // Excel
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // PowerPoint
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // RTF
    'application/rtf',
    'text/rtf'
  ];
  
  // 支持的文件扩展名（作为备用检查）
  const allowedExtensions = [
    '.pdf', '.doc', '.docx', '.txt', '.csv', 
    '.html', '.htm', '.md', '.markdown',
    '.xls', '.xlsx', '.ppt', '.pptx', '.rtf'
  ];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文档类型: ${file.mimetype} (${ext})`), false);
  }
};

// 创建文档上传中间件
const uploadDocument = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB - 文档可能比图片大
    files: 1 // 单次只允许上传一个文件
  }
}).single('document');

// 处理上传错误的中间件包装
const handleDocumentUpload = (req, res, next) => {
  uploadDocument(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('Multer文档上传错误', { error: err.message });
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: '文档大小不能超过50MB'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: `上传错误: ${err.message}`
      });
    } else if (err) {
      logger.error('文档上传错误', { error: err.message });
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    // 没有错误，继续处理
    next();
  });
};

// 文档内容提取器（简单实现，实际应用中可以使用专门的库）
const extractDocumentContent = async (filePath, mimeType) => {
  try {
    // 对于纯文本文件，直接读取内容
    if (mimeType === 'text/plain' || 
        mimeType === 'text/csv' || 
        mimeType === 'text/html' ||
        mimeType === 'text/markdown') {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.substring(0, 10000); // 限制内容长度
    }
    
    // 对于其他格式，暂时返回文件信息
    // 实际应用中应该使用如pdf-parse、mammoth等库来提取内容
    return `[文档文件: ${path.basename(filePath)}]`;
  } catch (error) {
    logger.error('提取文档内容失败', { filePath, error: error.message });
    return null;
  }
};

// 导出中间件
module.exports = {
  uploadDocument: handleDocumentUpload,
  
  // 工具函数：获取文件的公开访问URL
  getDocumentUrl: (filePath) => {
    // 获取相对于storage的路径
    const storageDir = path.join(path.dirname(config.upload.uploadDir), 'storage');
    const relativePath = path.relative(storageDir, filePath);
    // 转换为URL格式（使用正斜杠）
    return '/' + relativePath.split(path.sep).join('/');
  },
  
  // 工具函数：删除上传的文档
  deleteDocument: async (filePath) => {
    try {
      await fs.unlink(filePath);
      logger.info('文档删除成功', { filePath });
    } catch (error) {
      logger.error('文档删除失败', { filePath, error: error.message });
    }
  },
  
  // 工具函数：提取文档内容
  extractContent: extractDocumentContent
};
