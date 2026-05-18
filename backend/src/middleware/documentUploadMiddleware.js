/**
 * 文档上传中间件
 * 
 * 职责：
 * 1. 处理文档上传（PDF/Word/TXT/Excel/PPT/RTF 等12种格式）
 * 2. 磁盘存储（避免内存溢出），50MB大小限制
 * 3. 文档内容提取（纯文本格式直接读取，其他格式返回占位符）
 * 4. 大文件预警（PDF > 25MB 时记录警告日志，提醒用户性能影响）
 * 
 * 存储路径：{uploadDir}/documents/{YYYY-MM}/doc_{timestamp}_{random}{ext}
 * 
 * v2.0 变更（2026-05-18 大文件预警）：
 *   - 增加 PDF_SIZE_WARN_THRESHOLD（25MB）软阈值，超过时记录警告
 *   - 50MB 硬限制不变（Multer 层）
 *   - 30MB base64 编码硬限制由 AI 服务层处理
 *   - 提供 getSizeWarning() 工具函数给上层判断是否需要给前端返回警告
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * 文件大小相关常量
 */
const MAX_FILE_SIZE = 50 * 1024 * 1024;           // 硬限制：50MB
const PDF_SIZE_WARN_THRESHOLD = 25 * 1024 * 1024;  // 软警告：25MB（接近 30MB base64 限制）
const PDF_SIZE_HARD_LIMIT = 30 * 1024 * 1024;      // base64 编码硬限制：30MB

/**
 * 确保上传目录存在
 */
const ensureUploadDir = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    logger.info('创建文档上传目录', { dirPath });
  }
};

/**
 * 生成唯一文件名
 */
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `doc_${timestamp}_${random}${ext}`;
};

/**
 * 修复中文文件名编码问题
 */
const fixFileName = (filename) => {
  if (!filename) return filename;

  try {
    if (/^[\x20-\x7F]*$/.test(filename)) {
      return filename;
    }

    const buffer = Buffer.from(filename, 'latin1');
    const decoded = buffer.toString('utf8');

    if (decoded.includes('�')) {
      logger.warn('文档文件名解码失败，使用原始文件名', { original: filename });
      return filename;
    }

    return decoded;
  } catch (error) {
    logger.error('修复文档文件名编码时出错', { filename, error: error.message });
    return filename;
  }
};

/**
 * Multer 磁盘存储配置
 */
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadBase = config.upload.uploadDir;
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
    const fixedName = fixFileName(file.originalname);
    file.originalname = fixedName;
    const fileName = generateFileName(fixedName);
    cb(null, fileName);
  }
});

/**
 * 文档文件过滤器
 */
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'text/html',
    'text/markdown',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'text/rtf'
  ];

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

/**
 * 文档上传 Multer 实例
 */
const uploadDocument = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
}).single('document');

/**
 * v2.0：获取文件大小警告信息
 * 
 * @param {Object} file - Multer 上传的文件对象
 * @returns {Object|null} 警告信息对象，无警告时返回 null
 */
const getSizeWarning = (file) => {
  if (!file) return null;

  const isPDF = file.mimetype === 'application/pdf' ||
                (file.originalname && file.originalname.toLowerCase().endsWith('.pdf'));

  if (!isPDF) return null;

  if (file.size > PDF_SIZE_HARD_LIMIT) {
    return {
      level: 'error',
      message: `PDF 文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 ${PDF_SIZE_HARD_LIMIT / 1024 / 1024}MB 限制，可能无法被AI模型处理`,
      sizeMB: (file.size / 1024 / 1024).toFixed(1),
      limitMB: PDF_SIZE_HARD_LIMIT / 1024 / 1024
    };
  }

  if (file.size > PDF_SIZE_WARN_THRESHOLD) {
    return {
      level: 'warning',
      message: `PDF 文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 较大，可能影响 AI 响应速度`,
      sizeMB: (file.size / 1024 / 1024).toFixed(1),
      thresholdMB: PDF_SIZE_WARN_THRESHOLD / 1024 / 1024
    };
  }

  return null;
};

/**
 * 文档上传中间件 - 统一处理 Multer 错误，并附加大文件警告
 */
const handleDocumentUpload = (req, res, next) => {
  uploadDocument(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('Multer文档上传错误', { error: err.message });

      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `文档大小不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`
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

    // v2.0: 大文件预警
    if (req.file) {
      const warning = getSizeWarning(req.file);
      if (warning) {
        logger.warn('大文件上传预警', {
          filename: req.file.originalname,
          size: req.file.size,
          warning
        });
        // 把警告挂到 req 对象，供 Controller 选择性返回给前端
        req.fileSizeWarning = warning;
      }
    }

    next();
  });
};

/**
 * 文档内容提取器
 */
const extractDocumentContent = async (filePath, mimeType) => {
  try {
    if (mimeType === 'text/plain' ||
        mimeType === 'text/csv' ||
        mimeType === 'text/html' ||
        mimeType === 'text/markdown') {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.substring(0, 10000);
    }

    return `[文档文件: ${path.basename(filePath)}]`;
  } catch (error) {
    logger.error('提取文档内容失败', { filePath, error: error.message });
    return null;
  }
};

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  uploadDocument: handleDocumentUpload,

  getDocumentUrl: (filePath) => {
    const storageDir = path.join(path.dirname(config.upload.uploadDir), 'storage');
    const relativePath = path.relative(storageDir, filePath);
    return '/' + relativePath.split(path.sep).join('/');
  },

  deleteDocument: async (filePath) => {
    try {
      await fs.unlink(filePath);
      logger.info('文档删除成功', { filePath });
    } catch (error) {
      logger.error('文档删除失败', { filePath, error: error.message });
    }
  },

  extractContent: extractDocumentContent,

  /** v2.0：导出大小警告工具函数 */
  getSizeWarning,

  /** 导出常量供其他模块使用 */
  MAX_FILE_SIZE,
  PDF_SIZE_WARN_THRESHOLD,
  PDF_SIZE_HARD_LIMIT
};
