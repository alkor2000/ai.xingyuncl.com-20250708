/**
 * AI训练专区样本上传中间件
 *
 * 流程：multer 内存存储（字段 files / files[]，≤20 个，每个 ≤5MB，仅 jpeg/png/webp）
 *       → sharp 自动纠正 EXIF 方向、缩到最长边 320px、JPEG 质量 85
 *       → req.aiLabImages = [{ buffer, width, height, size, originalname }]
 *
 * 落盘由 AiLabService.storeSampleImages 完成，本中间件只处理内存中的图片。
 * 错误处理参考 routes/forum.js 的 handleUpload：统一返回 400 JSON。
 */

const multer = require('multer');
const sharp = require('sharp');
const logger = require('../utils/logger');
const ResponseHelper = require('../utils/response');

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILES = 20;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_EDGE = 320;
const JPEG_QUALITY = 85;

const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的图片格式: ${file.mimetype}，仅支持 JPG/PNG/WebP`), false);
  }
};

const sampleMulter = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES }
}).fields([
  { name: 'files', maxCount: MAX_FILES },
  { name: 'files[]', maxCount: MAX_FILES }
]);

/**
 * 接收 multipart，把两种字段名归并为 req.aiLabFiles 数组
 */
const uploadSampleImages = (req, res, next) => {
  sampleMulter(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `单张图片不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        LIMIT_FILE_COUNT: `一次最多上传 ${MAX_FILES} 张图片`,
        LIMIT_UNEXPECTED_FILE: '上传字段名错误，请使用 files'
      };
      logger.warn('AI实验样本上传 Multer 错误', { code: err.code, message: err.message });
      return ResponseHelper.error(res, messages[err.code] || `上传失败: ${err.message}`, 400);
    }
    if (err) {
      logger.warn('AI实验样本上传错误', { error: err.message });
      return ResponseHelper.error(res, err.message, 400);
    }

    const grouped = req.files || {};
    req.aiLabFiles = [...(grouped.files || []), ...(grouped['files[]'] || [])];
    next();
  });
};

/**
 * sharp 处理：纠正方向、缩放到最长边 320px、JPEG 85
 */
const processSampleImages = async (req, res, next) => {
  const files = req.aiLabFiles || [];
  if (files.length === 0) {
    return ResponseHelper.error(res, '请至少上传一张图片（字段名 files）', 400);
  }
  if (files.length > MAX_FILES) {
    return ResponseHelper.error(res, `一次最多上传 ${MAX_FILES} 张图片`, 400);
  }

  try {
    req.aiLabImages = await Promise.all(files.map(async (file, index) => {
      try {
        const { data, info } = await sharp(file.buffer)
          .rotate()
          .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer({ resolveWithObject: true });
        return {
          buffer: data,
          width: info.width,
          height: info.height,
          size: data.length,
          originalname: Buffer.from(file.originalname || '', 'latin1').toString('utf8')
        };
      } catch (error) {
        logger.warn('AI实验样本图片解码失败', { index, error: error.message });
        throw new Error(`第 ${index + 1} 个文件不是有效的图片`);
      }
    }));
    next();
  } catch (error) {
    return ResponseHelper.error(res, error.message, 400);
  }
};

module.exports = {
  /** 组合中间件：multer 接收 + sharp 处理 */
  handleSampleUpload: [uploadSampleImages, processSampleImages],
  uploadSampleImages,
  processSampleImages,
  ALLOWED_IMAGE_MIMES,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_EDGE
};
