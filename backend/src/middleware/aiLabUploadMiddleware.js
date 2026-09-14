/**
 * AI训练专区样本上传中间件（按数据集 kind 分流）
 *
 * 图像（kind=image）：multer 内存存储（字段 files / files[]，≤20 个，每个 ≤5MB，仅 jpeg/png/webp）
 *       → sharp 自动纠正 EXIF 方向、缩到最长边 320px、JPEG 质量 85
 *       → req.aiLabImages = [{ buffer, width, height, size, originalname }]
 * 音频（kind=audio）：multer 内存存储（字段同上，≤20 个，每个 ≤2MB）
 *       mimetype ∈ audio/wav, audio/x-wav, audio/wave, audio/webm, audio/ogg, audio/mpeg；
 *       浏览器给 application/octet-stream 时按扩展名 .wav/.webm/.ogg/.mp3 放行
 *       → 校验文件头（RIFF/WAVE、EBML、OggS、ID3/帧同步）→ 原样保留
 *       → req.aiLabAudio = [{ buffer, ext, size, originalname }]
 * 表格 / 文本（kind=table|text）：不接收文件，直接 400（用 rows 接口）
 *
 * 分流依据：前置中间件（AiLabController.resolveUploadTarget）放在 req.aiLabUpload.dataset 的 kind；
 * 缺省按 image 处理。落盘由 AiLabService.storeSampleImages / storeSampleAudio 完成。
 * 错误处理参考 routes/forum.js 的 handleUpload：统一返回 400 JSON。
 */

const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const logger = require('../utils/logger');
const ResponseHelper = require('../utils/response');

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILES = 20;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_EDGE = 320;
const JPEG_QUALITY = 85;

/** 音频：mimetype → 落盘扩展名 */
const AUDIO_MIME_EXT = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3'
};
const ALLOWED_AUDIO_MIMES = Object.keys(AUDIO_MIME_EXT);
const AUDIO_EXTENSIONS = ['wav', 'webm', 'ogg', 'mp3'];
const OCTET_STREAM = 'application/octet-stream';
const MAX_AUDIO_FILE_SIZE = 2 * 1024 * 1024;

const FILE_FIELDS = [
  { name: 'files', maxCount: MAX_FILES },
  { name: 'files[]', maxCount: MAX_FILES }
];

/* ================================================================
 * 通用
 * ================================================================ */

const decodeOriginalName = (name) => Buffer.from(name || '', 'latin1').toString('utf8');

/** 归一化 mimetype：去参数、小写 */
const baseMime = (mimetype) => String(mimetype || '').split(';')[0].trim().toLowerCase();

/** 原始文件名的扩展名（小写、不带点） */
const extOf = (originalname) => path.extname(decodeOriginalName(originalname)).slice(1).toLowerCase();

/**
 * 统一处理 multer 错误并把两种字段名归并为 req.aiLabFiles
 * @param {Function} upload - multer 实例的 .fields() 处理器
 * @param {{maxFileSize:number, noun:string}} options - 错误文案参数
 */
const runMulter = (upload, { maxFileSize, noun }) => (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `单个${noun}不能超过 ${maxFileSize / 1024 / 1024}MB`,
        LIMIT_FILE_COUNT: `一次最多上传 ${MAX_FILES} 个${noun}`,
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
    if (req.aiLabFiles.length === 0) {
      return ResponseHelper.error(res, `请至少上传一个${noun}（字段名 files）`, 400);
    }
    if (req.aiLabFiles.length > MAX_FILES) {
      return ResponseHelper.error(res, `一次最多上传 ${MAX_FILES} 个${noun}`, 400);
    }
    next();
  });
};

/* ================================================================
 * 图像
 * ================================================================ */

const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIMES.includes(baseMime(file.mimetype))) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的图片格式: ${file.mimetype}，仅支持 JPG/PNG/WebP`), false);
  }
};

const imageMulter = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES }
}).fields(FILE_FIELDS);

/** 接收 multipart 图片，归并为 req.aiLabFiles */
const uploadSampleImages = runMulter(imageMulter, { maxFileSize: MAX_FILE_SIZE, noun: '图片' });

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
          originalname: decodeOriginalName(file.originalname)
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

/* ================================================================
 * 音频
 * ================================================================ */

/**
 * 按 mimetype（octet-stream 时按扩展名）决定落盘扩展名；不允许返回 null
 */
const resolveAudioExt = (file) => {
  const mime = baseMime(file.mimetype);
  if (AUDIO_MIME_EXT[mime]) return AUDIO_MIME_EXT[mime];
  if (mime === OCTET_STREAM) {
    const ext = extOf(file.originalname);
    return AUDIO_EXTENSIONS.includes(ext) ? ext : null;
  }
  return null;
};

const audioFileFilter = (req, file, cb) => {
  if (resolveAudioExt(file)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的音频格式: ${file.mimetype}，仅支持 WAV/WebM/OGG/MP3`), false);
  }
};

const audioMulter = multer({
  storage: multer.memoryStorage(),
  fileFilter: audioFileFilter,
  limits: { fileSize: MAX_AUDIO_FILE_SIZE, files: MAX_FILES }
}).fields(FILE_FIELDS);

/** 接收 multipart 音频，归并为 req.aiLabFiles */
const uploadSampleAudio = runMulter(audioMulter, { maxFileSize: MAX_AUDIO_FILE_SIZE, noun: '音频文件' });

/**
 * 文件头校验（不解码）：
 * wav → 'RIFF' + 'WAVE'；webm → EBML 头 1A 45 DF A3；ogg → 'OggS'；mp3 → 'ID3' 或帧同步 0xFFEx
 */
const looksLikeAudio = (buffer, ext) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  switch (ext) {
    case 'wav':
      return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
    case 'webm':
      return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    case 'ogg':
      return buffer.toString('ascii', 0, 4) === 'OggS';
    case 'mp3':
      return buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    default:
      return false;
  }
};

/**
 * 音频不做转码：校验文件头后原样放入 req.aiLabAudio
 */
const processSampleAudio = (req, res, next) => {
  const files = req.aiLabFiles || [];
  if (files.length === 0) {
    return ResponseHelper.error(res, '请至少上传一个音频文件（字段名 files）', 400);
  }
  if (files.length > MAX_FILES) {
    return ResponseHelper.error(res, `一次最多上传 ${MAX_FILES} 个音频文件`, 400);
  }

  const audio = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const ext = resolveAudioExt(file);
    if (!ext || !looksLikeAudio(file.buffer, ext)) {
      logger.warn('AI实验音频样本文件头校验失败', { index, mimetype: file.mimetype, ext });
      return ResponseHelper.error(res, `第 ${index + 1} 个文件不是有效的音频文件`, 400);
    }
    audio.push({
      buffer: file.buffer,
      ext,
      size: file.buffer.length,
      originalname: decodeOriginalName(file.originalname)
    });
  }
  req.aiLabAudio = audio;
  next();
};

/* ================================================================
 * 分流
 * ================================================================ */

const handleImageUpload = [uploadSampleImages, processSampleImages];
const handleAudioUpload = [uploadSampleAudio, processSampleAudio];

/** 顺序执行一组中间件 */
const runChain = (chain, req, res, next) => {
  let index = 0;
  const step = (err) => {
    if (err) return next(err);
    const fn = chain[index++];
    if (!fn) return next();
    return fn(req, res, step);
  };
  step();
};

/**
 * 按 req.aiLabUpload.dataset.kind 选择管线（缺省 image）；table/text 直接 400
 */
const handleSampleUpload = (req, res, next) => {
  const kind = (req.aiLabUpload && req.aiLabUpload.dataset && req.aiLabUpload.dataset.kind) || 'image';
  if (kind === 'image') return runChain(handleImageUpload, req, res, next);
  if (kind === 'audio') return runChain(handleAudioUpload, req, res, next);
  const noun = kind === 'text' ? '文本' : '表格';
  return ResponseHelper.error(res, `${noun}数据集不能上传文件样本，请用 rows 接口添加行`, 400);
};

module.exports = {
  /** 分流中间件：按数据集 kind 走图像或音频管线 */
  handleSampleUpload,
  handleImageUpload,
  handleAudioUpload,
  uploadSampleImages,
  processSampleImages,
  uploadSampleAudio,
  processSampleAudio,
  looksLikeAudio,
  resolveAudioExt,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_AUDIO_MIMES,
  AUDIO_EXTENSIONS,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_AUDIO_FILE_SIZE,
  MAX_EDGE,
  JPEG_QUALITY
};
