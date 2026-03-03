/**
 * 文件上传中间件
 * 处理图片上传，支持对话中的图片附件
 * 
 * v2.0 变更：
 *   - 从 single('image') 改为 array('image', 5)，支持最多5张图片同时上传
 *   - 单张图片大小限制从 10MB 改为 5MB
 *   - 新增 LIMIT_FILE_COUNT 错误处理
 *   - 修复中文文件名编码问题（latin1 -> utf8）
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

// ============================================================
// 工具函数
// ============================================================

/**
 * 确保上传目录存在，不存在则递归创建
 * @param {string} dirPath - 目录路径
 */
const ensureUploadDir = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    logger.info('创建上传目录', { dirPath });
  }
};

/**
 * 生成唯一文件名：时间戳 + 随机8字节hex + 原始扩展名
 * @param {string} originalName - 原始文件名
 * @returns {string} 唯一文件名
 */
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `${timestamp}-${random}${ext}`;
};

// ============================================================
// Multer 存储配置
// ============================================================

/**
 * 磁盘存储配置
 * - 图片按年月分目录存储：chat-images/YYYY-MM/
 * - 其他文件存储到 others/ 目录
 * - 支持 Docker 容器和 PM2 两种部署模式（通过 config.upload.uploadDir 控制）
 */
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadBase = config.upload.uploadDir;
    let uploadDir = uploadBase;

    // 根据文件类型分类存储目录
    if (file.mimetype.startsWith('image/')) {
      // 按年月分目录，避免单目录文件过多
      const yearMonth = new Date().toISOString().slice(0, 7);
      uploadDir = path.join(uploadBase, 'chat-images', yearMonth);
    } else {
      uploadDir = path.join(uploadBase, 'others');
    }

    try {
      await ensureUploadDir(uploadDir);
      cb(null, uploadDir);
    } catch (error) {
      logger.error('创建上传目录失败', { error: error.message, uploadDir });
      cb(error);
    }
  },

  filename: (req, file, cb) => {
    // 修复中文文件名编码问题：multer 默认使用 latin1，需要转换为 utf8
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // 将修正后的文件名写回 file 对象，方便后续使用
    file.originalname = originalName;
    const fileName = generateFileName(originalName);
    cb(null, fileName);
  }
});

// ============================================================
// 文件过滤器
// ============================================================

/**
 * 支持的图片 MIME 类型白名单
 */
const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp'
];

/**
 * 图片文件过滤器 - 只允许白名单内的图片格式通过
 */
const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的图片格式: ${file.mimetype}，仅支持 JPG/PNG/GIF/WebP/BMP`), false);
  }
};

// ============================================================
// Multer 实例
// ============================================================

/**
 * 图片上传 Multer 实例
 * v2.0: array('image', 5) 支持最多5张图片同时上传，每张≤5MB
 */
const uploadImageMulter = multer({
  storage: storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,   // 单张图片最大 5MB
    files: 5                      // 最多同时上传 5 张
  }
}).array('image', 5);

// ============================================================
// 错误处理包装中间件
// ============================================================

/**
 * 图片上传中间件 - 统一处理 Multer 错误，返回友好的中文提示
 */
const uploadImage = (req, res, next) => {
  uploadImageMulter(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // Multer 内置错误
      logger.error('Multer上传错误', { code: err.code, message: err.message, field: err.field });

      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          return res.status(400).json({
            success: false,
            message: '单张图片大小不能超过 5MB，请压缩后重试'
          });
        case 'LIMIT_FILE_COUNT':
          return res.status(400).json({
            success: false,
            message: '最多同时上传 5 张图片'
          });
        case 'LIMIT_UNEXPECTED_FILE':
          return res.status(400).json({
            success: false,
            message: '上传字段名错误，请使用正确的上传方式'
          });
        default:
          return res.status(400).json({
            success: false,
            message: `上传失败: ${err.message}`
          });
      }
    } else if (err) {
      // 自定义错误（如文件类型不支持）
      logger.error('文件上传错误', { error: err.message });
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    // 没有错误，继续
    next();
  });
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取文件的公开访问 URL
 * 将磁盘绝对路径转换为相对 URL 路径
 * @param {string} filePath - 文件的绝对磁盘路径
 * @returns {string} 公开访问 URL（如 /uploads/chat-images/2026-01/xxx.jpg）
 */
const getFileUrl = (filePath) => {
  const storageDir = path.join(path.dirname(config.upload.uploadDir), 'storage');
  const relativePath = path.relative(storageDir, filePath);
  // 转换为 URL 格式（统一使用正斜杠，兼容 Windows/Linux）
  return '/' + relativePath.split(path.sep).join('/');
};

/**
 * 删除已上传的文件（用于清理临时文件或上传失败回滚）
 * @param {string} filePath - 文件的绝对磁盘路径
 */
const deleteFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
    logger.info('文件删除成功', { filePath });
  } catch (error) {
    logger.error('文件删除失败', { filePath, error: error.message });
  }
};

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  /** 图片上传中间件（v2.0: 支持最多5张，每张≤5MB） */
  uploadImage,

  /** 获取文件公开访问 URL */
  getFileUrl,

  /** 删除上传的文件 */
  deleteFile,

  /** 支持的图片 MIME 类型列表（供前端校验参考） */
  ALLOWED_IMAGE_MIMES
};
