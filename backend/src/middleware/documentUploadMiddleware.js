/**
 * 文档上传中间件
 * 
 * 职责：
 * 1. 处理文档上传（PDF/Word/TXT/Excel/PPT/RTF 等12种格式）
 * 2. 磁盘存储（避免内存溢出），50MB大小限制
 * 3. 文档内容提取（纯文本格式直接读取，其他格式返回占位符）
 * 
 * 存储路径：{uploadDir}/documents/{YYYY-MM}/doc_{timestamp}_{random}{ext}
 * 
 * 修复：中文文件名编码修复（latin1 -> utf8），与 uploadMiddleware.js 保持一致
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * 确保上传目录存在，不存在则递归创建
 * @param {string} dirPath - 目录路径
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
 * 生成唯一文件名：doc_ + 时间戳 + 随机8字节hex + 扩展名
 * @param {string} originalName - 原始文件名
 * @returns {string} 唯一文件名
 */
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `doc_${timestamp}_${random}${ext}`;
};

/**
 * 修复中文文件名编码问题
 * Multer 默认使用 latin1 编码读取文件名，中文会乱码
 * 需要从 latin1 转换回 utf8
 * 
 * @param {string} filename - 原始文件名（可能是 latin1 编码）
 * @returns {string} 修复后的 utf8 文件名
 */
const fixFileName = (filename) => {
  if (!filename) return filename;

  try {
    // 纯ASCII字符不需要转换
    if (/^[\x00-\x7F]*$/.test(filename)) {
      return filename;
    }

    // 从 latin1 转换为 utf8
    const buffer = Buffer.from(filename, 'latin1');
    const decoded = buffer.toString('utf8');

    // 验证解码结果是否有效
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
 * 文档按年月分目录：documents/YYYY-MM/
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
    // 修复中文文件名编码问题
    const fixedName = fixFileName(file.originalname);
    file.originalname = fixedName;
    const fileName = generateFileName(fixedName);
    cb(null, fileName);
  }
});

/**
 * 文档文件过滤器
 * 支持 MIME 类型白名单 + 扩展名备用检查
 */
const fileFilter = (req, file, cb) => {
  // 支持的文档 MIME 类型
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

  // 备用扩展名白名单
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
 * 单文件上传，最大50MB
 */
const uploadDocument = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  }
}).single('document');

/**
 * 文档上传中间件 - 统一处理 Multer 错误
 */
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

    next();
  });
};

/**
 * 文档内容提取器
 * 
 * 目前支持纯文本格式的直接读取，内容限制10000字符
 * PDF/Word/Excel 等格式返回占位符（这些格式通过 URL 发送给 AI 处理）
 * 
 * @param {string} filePath - 文件磁盘路径
 * @param {string} mimeType - MIME 类型
 * @returns {string|null} 提取的文本内容
 */
const extractDocumentContent = async (filePath, mimeType) => {
  try {
    // 纯文本格式直接读取
    if (mimeType === 'text/plain' ||
        mimeType === 'text/csv' ||
        mimeType === 'text/html' ||
        mimeType === 'text/markdown') {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.substring(0, 10000);
    }

    // 其他格式返回文件信息占位符
    // PDF 等通过 URL 直接发送给 OpenRouter 的 file-parser 插件处理
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
  /** 文档上传中间件（单文件，最大50MB） */
  uploadDocument: handleDocumentUpload,

  /**
   * 获取文档的公开访问 URL
   * 将磁盘绝对路径转换为相对 URL 路径
   * @param {string} filePath - 文件的绝对磁盘路径
   * @returns {string} 相对 URL 路径
   */
  getDocumentUrl: (filePath) => {
    const storageDir = path.join(path.dirname(config.upload.uploadDir), 'storage');
    const relativePath = path.relative(storageDir, filePath);
    return '/' + relativePath.split(path.sep).join('/');
  },

  /**
   * 删除上传的文档
   * @param {string} filePath - 文件的绝对磁盘路径
   */
  deleteDocument: async (filePath) => {
    try {
      await fs.unlink(filePath);
      logger.info('文档删除成功', { filePath });
    } catch (error) {
      logger.error('文档删除失败', { filePath, error: error.message });
    }
  },

  /** 提取文档内容 */
  extractContent: extractDocumentContent
};
