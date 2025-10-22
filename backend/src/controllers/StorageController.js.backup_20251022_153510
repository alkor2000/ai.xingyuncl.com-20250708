/**
 * 存储管理控制器 - 增强版
 * 支持全局文件夹、组织文件夹和个人文件夹
 * 处理文件上传、下载、管理等操作
 * 修改：移除所有硬编码路径，完全支持环境变量和Docker部署
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const ossService = require('../services/ossService');
const UserFile = require('../models/UserFile');
const UserFolder = require('../models/UserFolder');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const dbConnection = require('../database/connection');
const config = require('../config');  // 导入配置

/**
 * 修复文件名编码问题
 * Multer默认使用latin1编码，需要转换为UTF-8
 */
const fixFileName = (filename) => {
  if (!filename) return filename;
  
  try {
    // 检测是否已经是正确的UTF-8编码
    if (/^[\x00-\x7F]*$/.test(filename)) {
      return filename;
    }
    
    // 尝试从latin1转换为UTF-8
    const buffer = Buffer.from(filename, 'latin1');
    const decoded = buffer.toString('utf8');
    
    // 验证解码后的字符串是否有效
    if (decoded.includes('�')) {
      logger.warn('文件名解码失败，使用原始文件名', { original: filename });
      return filename;
    }
    
    logger.info('文件名编码修复成功', { 
      original: filename,
      fixed: decoded 
    });
    
    return decoded;
  } catch (error) {
    logger.error('修复文件名编码时出错', { 
      filename, 
      error: error.message 
    });
    return filename;
  }
};

/**
 * 生成唯一的临时文件名
 */
const generateTempFileName = (originalName) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  return `temp_${timestamp}_${random}${ext}`;
};

/**
 * 获取存储配置
 * 从数据库动态读取文件大小限制等配置
 */
const getStorageConfig = async () => {
  try {
    const sql = `SELECT * FROM storage_credits_config_simple WHERE is_active = 1 LIMIT 1`;
    const { rows } = await dbConnection.query(sql);
    
    if (rows.length > 0) {
      const config = rows[0];
      return {
        maxFileSize: config.max_file_size * 1024 * 1024, // 转换为字节
        maxFiles: 20, // 最大文件数
        baseCredits: parseInt(config.base_credits),
        creditsPerInterval: parseFloat(config.credits_per_5mb)
      };
    }
    
    // 默认配置
    logger.warn('未找到存储配置，使用默认值');
    return {
      maxFileSize: 100 * 1024 * 1024, // 默认100MB
      maxFiles: 10,
      baseCredits: 2,
      creditsPerInterval: 1
    };
  } catch (error) {
    logger.error('获取存储配置失败:', error);
    // 返回安全的默认值
    return {
      maxFileSize: 100 * 1024 * 1024,
      maxFiles: 10,
      baseCredits: 2,
      creditsPerInterval: 1
    };
  }
};

/**
 * 配置multer磁盘存储
 * 使用磁盘存储避免内存溢出
 * 修改：使用配置文件中的路径而不是硬编码
 */
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // 使用配置中的临时目录路径
    const tempDir = config.storage.paths.temp;
    
    try {
      // 确保临时目录存在
      await fs.mkdir(tempDir, { recursive: true });
      logger.debug('使用临时目录', { tempDir });
      cb(null, tempDir);
    } catch (error) {
      logger.error('创建临时目录失败', { 
        tempDir,
        error: error.message 
      });
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // 修复文件名编码并生成临时文件名
    file.originalname = fixFileName(file.originalname);
    const tempFileName = generateTempFileName(file.originalname);
    cb(null, tempFileName);
  }
});

// 文件过滤器 - 增强版，支持更多文件类型
const fileFilter = (req, file, cb) => {
  // 修复文件名编码
  file.originalname = fixFileName(file.originalname);
  
  // 获取文件扩展名（小写）
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  
  // 危险文件扩展名黑名单（禁止上传）
  const dangerousExtensions = [
    // 可执行文件
    'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'app', 'deb', 'rpm',
    // 脚本文件（服务器端）
    'php', 'jsp', 'asp', 'aspx', 'cgi', 'pl', 'sh', 'bash',
    // 系统文件
    'sys', 'dll', 'so', 'dylib',
    // 其他危险文件
    'jar', 'war', 'ear', 'class'
  ];
  
  // 检查是否为危险文件
  if (dangerousExtensions.includes(ext)) {
    cb(new Error(`出于安全考虑，不允许上传 .${ext} 文件`), false);
    return;
  }
  
  // 扩展的白名单（允许的MIME类型）
  const allowedMimes = [
    // === 图片 ===
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 
    'image/bmp', 'image/svg+xml', 'image/tiff', 'image/ico', 'image/x-icon',
    
    // === 音频 ===
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
    'audio/ogg', 'audio/webm', 'audio/flac', 'audio/aac', 'audio/mp4',
    'audio/x-m4a', 'audio/midi', 'audio/x-midi', 'audio/wma', 'audio/x-ms-wma',
    
    // === 视频 ===
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo',
    'video/x-ms-wmv', 'video/webm', 'video/ogg', 'video/x-flv',
    'video/x-matroska', 'video/3gpp', 'video/x-m4v',
    
    // === 文档 ===
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation', 'application/rtf',
    
    // === 文本和代码 ===
    'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
    'text/xml', 'text/markdown', 'text/x-markdown',
    'application/json', 'application/xml', 'application/javascript',
    'application/x-javascript', 'application/typescript', 'application/x-yaml',
    'text/yaml', 'text/x-yaml', 'application/sql',
    
    // === 压缩文件 ===
    'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
    'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
    'application/x-gzip', 'application/x-bzip', 'application/x-bzip2',
    'application/x-compressed', // 添加对rar文件的支持
    
    // === 设计文件 ===
    'application/postscript', 'application/illustrator', 'image/vnd.adobe.photoshop',
    'application/x-photoshop', 'application/psd', 'image/x-psd',
    
    // === 电子书 ===
    'application/epub+zip', 'application/x-mobipocket-ebook',
    
    // === 字体文件 ===
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-woff',
    'application/x-font-ttf', 'application/x-font-otf',
    
    // === 其他常见格式 ===
    'application/octet-stream', // 二进制文件（需要额外检查扩展名）
    'application/x-sqlite3', 'application/x-sqlite',
    'text/calendar', 'text/vcard'
  ];
  
  // 安全的文件扩展名白名单（即使MIME类型不在列表中也允许）
  const safeExtensions = [
    // 文档
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'odt', 'ods', 'odp', 'rtf',
    // 图片
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif',
    // 音频
    'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'mid', 'midi', 'amr',
    // 视频  
    'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpg', 'mpeg', '3gp', 'm4v', 'vob',
    // 压缩
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
    // 文本和代码
    'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'cfg',
    'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'sass', 'less', 'html', 'htm',
    'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'swift', 'kt',
    'rb', 'lua', 'r', 'scala', 'groovy', 'dart', 'sql', 'sh', 'ps1',
    // 设计
    'psd', 'ai', 'sketch', 'fig', 'xd', 'eps',
    // 电子书
    'epub', 'mobi', 'azw', 'azw3',
    // 字体
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    // 数据文件
    'csv', 'tsv', 'db', 'sqlite', 'sqlite3',
    // 其他
    'log', 'bak', 'tmp', 'ics', 'vcf', 'torrent'
  ];
  
  // 检查文件是否允许上传
  // 1. 如果MIME类型在白名单中，允许
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }
  
  // 2. 如果MIME类型是application/octet-stream或application/x-compressed，检查扩展名是否安全
  if ((file.mimetype === 'application/octet-stream' || file.mimetype === 'application/x-compressed') && safeExtensions.includes(ext)) {
    cb(null, true);
    return;
  }
  
  // 3. 对于某些文件，浏览器可能识别不出正确的MIME类型，检查扩展名
  if (safeExtensions.includes(ext)) {
    logger.info('通过扩展名白名单允许上传', {
      filename: file.originalname,
      ext: ext,
      mimetype: file.mimetype
    });
    cb(null, true);
    return;
  }
  
  // 4. 不在白名单中，拒绝上传
  cb(new Error(`不支持的文件类型: ${file.mimetype} (.${ext})`), false);
};

/**
 * 创建动态配置的multer中间件
 * 根据数据库配置动态设置文件大小限制
 */
const createUploadMiddleware = async () => {
  const storageConfig = await getStorageConfig();
  
  logger.info('创建上传中间件，使用配置:', {
    maxFileSize: `${storageConfig.maxFileSize / 1024 / 1024}MB`,
    maxFiles: storageConfig.maxFiles,
    tempDir: config.storage.paths.temp
  });
  
  return multer({
    storage: storage,  // 使用磁盘存储
    fileFilter: fileFilter,
    limits: {
      fileSize: storageConfig.maxFileSize,
      files: storageConfig.maxFiles
    }
  });
};

/**
 * 清理临时文件
 */
const cleanupTempFile = async (filePath) => {
  try {
    if (filePath) {
      await fs.unlink(filePath);
      logger.info('临时文件已删除', { filePath });
    }
  } catch (error) {
    logger.error('删除临时文件失败', { filePath, error: error.message });
  }
};

class StorageController {
  /**
   * 检查文件夹权限
   * @param {Object} folder - 文件夹对象
   * @param {Object} user - 用户对象
   * @param {string} action - 操作类型：upload/delete/view
   * @returns {boolean} 是否有权限
   */
  static checkFolderPermission(folder, user, action) {
    if (!folder) return true; // 根目录默认允许个人操作
    
    const folderType = folder.folder_type || 'personal';
    const userRole = user.role;
    const userGroupId = user.group_id;
    
    switch (folderType) {
      case 'global':
        // 全局文件夹
        if (action === 'upload' || action === 'delete') {
          return userRole === 'super_admin';
        }
        return true; // 所有人可查看
        
      case 'group':
        // 组织文件夹
        if (action === 'upload' || action === 'delete') {
          return userRole === 'admin' && userGroupId === folder.group_id;
        }
        // 查看权限：同组用户
        return userGroupId === folder.group_id;
        
      case 'personal':
      default:
        // 个人文件夹
        return folder.user_id === user.id;
    }
  }

  /**
   * 检查文件权限
   * @param {Object} file - 文件对象
   * @param {Object} user - 用户对象
   * @param {string} action - 操作类型：delete/download/view
   * @returns {boolean} 是否有权限
   */
  static async checkFilePermission(file, user, action) {
    // 获取文件所在文件夹信息
    if (file.folder_id) {
      const folderSql = 'SELECT * FROM user_folders WHERE id = ?';
      const { rows } = await dbConnection.query(folderSql, [file.folder_id]);
      
      if (rows.length > 0) {
        const folder = rows[0];
        const folderType = folder.folder_type || 'personal';
        
        switch (folderType) {
          case 'global':
            // 全局文件夹的文件：只有超管能删除
            if (action === 'delete') {
              return user.role === 'super_admin';
            }
            return true; // 所有人可查看和下载
            
          case 'group':
            // 组织文件夹的文件：只有组管理员能删除
            if (action === 'delete') {
              return user.role === 'admin' && user.group_id === folder.group_id;
            }
            // 查看和下载：同组用户
            return user.group_id === folder.group_id;
            
          case 'personal':
          default:
            // 个人文件：只有所有者有权限
            return file.user_id === user.id;
        }
      }
    }
    
    // 默认检查文件所有者
    return file.user_id === user.id;
  }

  /**
   * 上传文件 - 增强版，支持动态配置和不同类型文件夹
   */
  static uploadFiles = async (req, res, next) => {
    try {
      // 动态创建上传中间件
      const uploadMiddleware = await createUploadMiddleware();
      const upload = uploadMiddleware.array('files');
      
      // 处理文件上传
      upload(req, res, async (err) => {
        // 处理multer错误
        if (err) {
          logger.error('文件上传错误:', {
            error: err.message,
            code: err.code,
            field: err.field
          });
          
          if (err.code === 'LIMIT_FILE_SIZE') {
            const storageConfig = await getStorageConfig();
            const maxSizeMB = Math.round(storageConfig.maxFileSize / 1024 / 1024);
            return ResponseHelper.error(res, `文件大小不能超过${maxSizeMB}MB`);
          }
          
          if (err.code === 'LIMIT_FILE_COUNT') {
            const storageConfig = await getStorageConfig();
            return ResponseHelper.error(res, `单次最多上传${storageConfig.maxFiles}个文件`);
          }
          
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return ResponseHelper.error(res, '文件字段名错误');
          }
          
          return ResponseHelper.error(res, err.message || '文件上传失败');
        }
        
        // 继续处理上传逻辑
        await StorageController.processUploadedFiles(req, res);
      });
    } catch (error) {
      logger.error('创建上传中间件失败:', error);
      return ResponseHelper.error(res, '服务器配置错误');
    }
  };
  
  /**
   * 处理已上传的文件
   */
  static async processUploadedFiles(req, res) {
    logger.info('开始处理文件上传请求', {
      userId: req.user?.id,
      filesCount: req.files?.length,
      body: req.body
    });
    
    const tempFiles = []; // 记录所有临时文件路径，用于清理
    
    try {
      const userId = req.user.id;
      const { folder_id, is_public } = req.body;
      
      if (!req.files || req.files.length === 0) {
        logger.warn('上传请求中没有文件');
        return ResponseHelper.error(res, '请选择要上传的文件');
      }
      
      // 记录所有临时文件路径
      req.files.forEach(file => {
        tempFiles.push(file.path);
      });
      
      // 检查文件夹上传权限
      if (folder_id) {
        const folderSql = 'SELECT * FROM user_folders WHERE id = ?';
        const { rows } = await dbConnection.query(folderSql, [folder_id]);
        
        if (rows.length === 0) {
          // 清理临时文件
          for (const tempFile of tempFiles) {
            await cleanupTempFile(tempFile);
          }
          return ResponseHelper.notFound(res, '文件夹不存在');
        }
        
        const folder = rows[0];
        if (!StorageController.checkFolderPermission(folder, req.user, 'upload')) {
          // 清理临时文件
          for (const tempFile of tempFiles) {
            await cleanupTempFile(tempFile);
          }
          return ResponseHelper.forbidden(res, '无权在此文件夹上传文件');
        }
      }
      
      // 检查用户存储空间
      const userStorage = await UserFile.getUserStorage(userId);
      const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
      
      logger.info('存储空间检查', {
        used: userStorage.storage_used,
        quota: userStorage.storage_quota,
        toUpload: totalSize
      });
      
      if (userStorage.storage_used + totalSize > userStorage.storage_quota) {
        // 清理临时文件
        for (const tempFile of tempFiles) {
          await cleanupTempFile(tempFile);
        }
        return ResponseHelper.error(res, '存储空间不足');
      }
      
      // 计算积分消耗
      const creditCost = await StorageController.calculateCreditCost('upload', req.files);
      
      // 检查用户积分
      const userCredits = await StorageController.getUserCredits(userId);
      
      logger.info('积分检查', {
        available: userCredits,
        required: creditCost
      });
      
      if (userCredits < creditCost) {
        // 清理临时文件
        for (const tempFile of tempFiles) {
          await cleanupTempFile(tempFile);
        }
        return ResponseHelper.error(res, `积分不足，需要${creditCost}积分，当前可用${userCredits}积分`);
      }
      
      // 初始化OSS服务
      logger.info('初始化OSS服务...');
      await ossService.initialize();
      
      const uploadedFiles = [];
      const failedFiles = [];
      
      // 逐个上传文件到OSS
      for (const file of req.files) {
        try {
          const fixedFileName = file.originalname;
          
          logger.info('开始上传文件到OSS', {
            filename: fixedFileName,
            size: file.size,
            mimetype: file.mimetype,
            tempPath: file.path
          });
          
          // 生成OSS key
          const ossKey = ossService.generateOSSKey(userId, fixedFileName, folder_id);
          logger.info('生成的OSS Key', { ossKey });
          
          // 读取临时文件
          const fileBuffer = await fs.readFile(file.path);
          
          // 上传到OSS
          const uploadResult = await ossService.uploadFile(
            fileBuffer,
            ossKey,
            {
              headers: {
                'Content-Type': file.mimetype,
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fixedFileName)}`
              }
            }
          );
          
          logger.info('文件上传结果', {
            filename: fixedFileName,
            success: uploadResult.success,
            url: uploadResult.url,
            isLocal: uploadResult.isLocal
          });
          
          // 生成缩略图URL（如果是图片）
          let thumbnailUrl = null;
          if (file.mimetype.startsWith('image/')) {
            thumbnailUrl = ossService.generateThumbnailUrl(uploadResult.url);
          }
          
          // 保存到数据库 - 记录上传者
          const fileRecord = await UserFile.create({
            user_id: userId,
            uploaded_by: userId, // 记录实际上传者
            folder_id: folder_id || null,
            original_name: fixedFileName,
            stored_name: path.basename(ossKey),
            oss_key: ossKey,
            oss_url: uploadResult.url,
            file_size: file.size,
            mime_type: file.mimetype,
            file_ext: path.extname(fixedFileName),
            thumbnail_url: thumbnailUrl,
            is_public: is_public === 'true' || is_public === true
          });
          
          uploadedFiles.push(fileRecord);
          
          // 成功上传后立即删除临时文件
          await cleanupTempFile(file.path);
        } catch (error) {
          logger.error('文件上传失败:', {
            filename: file.originalname,
            error: error.message,
            stack: error.stack
          });
          failedFiles.push({
            filename: file.originalname,
            error: error.message
          });
          
          // 失败的文件也要删除临时文件
          await cleanupTempFile(file.path);
        }
      }
      
      // 扣除积分
      if (uploadedFiles.length > 0 && creditCost > 0) {
        await StorageController.deductCredits(userId, creditCost, '文件上传');
      }
      
      const result = {
        success: uploadedFiles,
        failed: failedFiles,
        credits_used: creditCost
      };
      
      logger.info('上传处理完成', {
        successCount: uploadedFiles.length,
        failedCount: failedFiles.length,
        creditsUsed: creditCost
      });
      
      if (uploadedFiles.length === 0) {
        return ResponseHelper.error(res, '所有文件上传失败', 500, result);
      } else if (failedFiles.length > 0) {
        return ResponseHelper.success(res, result, '部分文件上传成功');
      } else {
        return ResponseHelper.success(res, result, '文件上传成功');
      }
    } catch (error) {
      logger.error('文件上传处理失败:', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id
      });
      
      // 确保清理所有临时文件
      for (const tempFile of tempFiles) {
        await cleanupTempFile(tempFile);
      }
      
      return ResponseHelper.error(res, error.message || '文件上传失败');
    }
  }

  /**
   * 获取文件列表 - 增强版，包含不同类型文件夹的文件
   */
  static async getFiles(req, res) {
    try {
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      const userRole = req.user.role;
      const { folder_id, page = 1, limit = 50, order_by = 'created_at', order = 'DESC' } = req.query;
      
      // 如果指定了文件夹，检查访问权限
      if (folder_id && folder_id !== 'null') {
        const folderSql = 'SELECT * FROM user_folders WHERE id = ?';
        const { rows } = await dbConnection.query(folderSql, [folder_id]);
        
        if (rows.length > 0) {
          const folder = rows[0];
          if (!StorageController.checkFolderPermission(folder, req.user, 'view')) {
            return ResponseHelper.forbidden(res, '无权访问此文件夹');
          }
        }
      }
      
      const result = await UserFile.getUserFiles(userId, folder_id, {
        page: parseInt(page),
        limit: parseInt(limit),
        orderBy: order_by,
        order: order.toUpperCase(),
        userGroupId: userGroupId,
        userRole: userRole
      });
      
      return ResponseHelper.success(res, result, '获取文件列表成功');
    } catch (error) {
      logger.error('获取文件列表失败:', error);
      return ResponseHelper.error(res, '获取文件列表失败');
    }
  }

  /**
   * 删除文件 - 增强版，检查不同类型文件夹的权限
   */
  static async deleteFile(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      // 获取文件信息
      const file = await UserFile.findById(id);
      if (!file) {
        return ResponseHelper.notFound(res, '文件不存在');
      }
      
      // 检查删除权限
      const hasPermission = await StorageController.checkFilePermission(file, req.user, 'delete');
      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '无权删除此文件');
      }
      
      // 从OSS删除
      try {
        await ossService.deleteFile(file.oss_key);
      } catch (error) {
        logger.error('OSS文件删除失败，继续删除数据库记录:', error);
      }
      
      // 软删除数据库记录
      await file.softDelete();
      
      return ResponseHelper.success(res, null, '文件删除成功');
    } catch (error) {
      logger.error('删除文件失败:', error);
      return ResponseHelper.error(res, '删除文件失败');
    }
  }

  /**
   * 批量删除文件 - 增强版
   */
  static async deleteFiles(req, res) {
    try {
      const userId = req.user.id;
      const { file_ids } = req.body;
      
      if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
        return ResponseHelper.validation(res, ['请选择要删除的文件']);
      }
      
      const ossKeys = [];
      const deletedFiles = [];
      
      for (const fileId of file_ids) {
        const file = await UserFile.findById(fileId);
        if (file) {
          const hasPermission = await StorageController.checkFilePermission(file, req.user, 'delete');
          if (hasPermission) {
            ossKeys.push(file.oss_key);
            await file.softDelete();
            deletedFiles.push(fileId);
          }
        }
      }
      
      // 批量删除OSS文件
      if (ossKeys.length > 0) {
        try {
          await ossService.deleteFiles(ossKeys);
        } catch (error) {
          logger.error('批量删除OSS文件失败:', error);
        }
      }
      
      return ResponseHelper.success(res, {
        deleted: deletedFiles.length,
        total: file_ids.length
      }, '文件删除完成');
    } catch (error) {
      logger.error('批量删除文件失败:', error);
      return ResponseHelper.error(res, '批量删除文件失败');
    }
  }

  /**
   * 移动文件 - 增强版，检查目标文件夹权限
   */
  static async moveFile(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { target_folder_id } = req.body;
      
      // 检查文件
      const file = await UserFile.findById(id);
      if (!file) {
        return ResponseHelper.notFound(res, '文件不存在');
      }
      
      // 检查源文件权限
      const hasSourcePermission = await StorageController.checkFilePermission(file, req.user, 'delete');
      if (!hasSourcePermission) {
        return ResponseHelper.forbidden(res, '无权移动此文件');
      }
      
      // 检查目标文件夹权限
      if (target_folder_id) {
        const folderSql = 'SELECT * FROM user_folders WHERE id = ?';
        const { rows } = await dbConnection.query(folderSql, [target_folder_id]);
        
        if (rows.length > 0) {
          const targetFolder = rows[0];
          if (!StorageController.checkFolderPermission(targetFolder, req.user, 'upload')) {
            return ResponseHelper.forbidden(res, '无权移动文件到目标文件夹');
          }
        }
      }
      
      await file.moveTo(target_folder_id);
      
      return ResponseHelper.success(res, null, '文件移动成功');
    } catch (error) {
      logger.error('移动文件失败:', error);
      return ResponseHelper.error(res, '移动文件失败');
    }
  }

  /**
   * 创建文件夹 - 增强版，支持创建不同类型的文件夹
   */
  static async createFolder(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      const { name, parent_id, folder_type = 'personal' } = req.body;
      
      if (!name) {
        return ResponseHelper.validation(res, ['文件夹名称不能为空']);
      }
      
      // 权限检查
      if (folder_type === 'global' && userRole !== 'super_admin') {
        return ResponseHelper.forbidden(res, '只有超级管理员可以创建全局文件夹');
      }
      
      if (folder_type === 'group' && userRole !== 'admin') {
        return ResponseHelper.forbidden(res, '只有组管理员可以创建组织文件夹');
      }
      
      // 检查父文件夹权限
      if (parent_id) {
        const parentSql = 'SELECT * FROM user_folders WHERE id = ?';
        const { rows } = await dbConnection.query(parentSql, [parent_id]);
        
        if (rows.length > 0) {
          const parentFolder = rows[0];
          if (!StorageController.checkFolderPermission(parentFolder, req.user, 'upload')) {
            return ResponseHelper.forbidden(res, '无权在此文件夹创建子文件夹');
          }
        }
      }
      
      const folderData = {
        user_id: userId,
        parent_id: parent_id || null,
        name: name,
        folder_type: folder_type
      };
      
      // 如果是组织文件夹，设置group_id
      if (folder_type === 'group') {
        folderData.group_id = userGroupId;
      }
      
      const folder = await UserFolder.create(folderData);
      
      return ResponseHelper.success(res, folder, '文件夹创建成功');
    } catch (error) {
      logger.error('创建文件夹失败:', error);
      return ResponseHelper.error(res, '创建文件夹失败');
    }
  }

  /**
   * 获取文件夹列表 - 增强版，包含不同类型的文件夹
   */
  static async getFolders(req, res) {
    try {
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      const userRole = req.user.role;
      const { parent_id, tree, include_special } = req.query;
      
      let folders;
      
      if (tree === 'true') {
        // 获取树形结构，包含特殊文件夹
        folders = await UserFolder.getFolderTreeWithSpecial(userId, userGroupId, userRole);
      } else {
        // 获取平铺结构
        if (include_special === 'true') {
          // 包含全局和组织文件夹
          folders = await UserFolder.getUserFoldersWithSpecial(userId, userGroupId, userRole, parent_id);
        } else {
          // 只获取个人文件夹
          folders = await UserFolder.getUserFolders(userId, parent_id);
        }
      }
      
      return ResponseHelper.success(res, folders, '获取文件夹列表成功');
    } catch (error) {
      logger.error('获取文件夹列表失败:', error);
      return ResponseHelper.error(res, '获取文件夹列表失败');
    }
  }

  /**
   * 删除文件夹 - 增强版，检查权限
   */
  static async deleteFolder(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      const folder = await UserFolder.findById(id);
      if (!folder) {
        return ResponseHelper.notFound(res, '文件夹不存在');
      }
      
      // 检查删除权限
      if (!StorageController.checkFolderPermission(folder, req.user, 'delete')) {
        return ResponseHelper.forbidden(res, '无权删除此文件夹');
      }
      
      await folder.softDelete();
      
      return ResponseHelper.success(res, null, '文件夹删除成功');
    } catch (error) {
      logger.error('删除文件夹失败:', error);
      return ResponseHelper.error(res, '删除文件夹失败');
    }
  }

  /**
   * 获取存储统计
   */
  static async getStorageStats(req, res) {
    try {
      const userId = req.user.id;
      const stats = await UserFile.getUserStorage(userId);
      
      return ResponseHelper.success(res, stats, '获取存储统计成功');
    } catch (error) {
      logger.error('获取存储统计失败:', error);
      return ResponseHelper.error(res, '获取存储统计失败');
    }
  }

  /**
   * 计算积分消耗（保持原有逻辑）
   */
  static async calculateCreditCost(action, files) {
    try {
      if (action !== 'upload') {
        return 0;
      }
      
      const storageConfig = await getStorageConfig();
      let totalCost = 0;
      
      for (const file of files) {
        const fileSizeMB = file.size / (1024 * 1024);
        
        let fileCredits = 0;
        
        if (fileSizeMB <= 5) {
          fileCredits = storageConfig.baseCredits;
        } else {
          const extraIntervals = Math.ceil((fileSizeMB - 5) / 5);
          fileCredits = extraIntervals * storageConfig.creditsPerInterval;
        }
        
        totalCost += fileCredits;
        
        logger.info('文件积分计算', {
          filename: file.originalname,
          sizeMB: fileSizeMB.toFixed(2),
          baseCredits: storageConfig.baseCredits,
          creditsPerInterval: storageConfig.creditsPerInterval,
          fileCredits: fileCredits,
          calculation: fileSizeMB <= 5 ? '使用基础积分' : `超出${(fileSizeMB - 5).toFixed(2)}MB，${Math.ceil((fileSizeMB - 5) / 5)}个区间`
        });
      }
      
      return Math.ceil(totalCost);
    } catch (error) {
      logger.error('计算积分消耗失败:', error);
      return 0;
    }
  }

  /**
   * 获取文件类型分类
   */
  static getFileType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.includes('document') || mimeType.includes('pdf') || 
        mimeType.includes('word') || mimeType.includes('excel')) {
      return 'document';
    }
    return 'default';
  }

  /**
   * 获取用户积分
   */
  static async getUserCredits(userId) {
    try {
      const sql = 'SELECT credits_quota, used_credits FROM users WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [userId]);
      
      if (rows.length > 0) {
        const creditsQuota = rows[0].credits_quota || 0;
        const usedCredits = rows[0].used_credits || 0;
        const availableCredits = creditsQuota - usedCredits;
        
        logger.info('获取用户积分', { 
          userId, 
          creditsQuota, 
          usedCredits, 
          availableCredits 
        });
        
        return Math.max(0, availableCredits);
      }
      
      return 0;
    } catch (error) {
      logger.error('获取用户积分失败:', error);
      return 0;
    }
  }

  /**
   * 扣除用户积分
   */
  static async deductCredits(userId, amount, description = '文件上传') {
    try {
      const userCredits = await StorageController.getUserCredits(userId);
      if (userCredits < amount) {
        logger.warn('积分不足，无法扣除', { userId, required: amount, available: userCredits });
        return false;
      }
      
      const sql = 'UPDATE users SET used_credits = used_credits + ? WHERE id = ?';
      await dbConnection.query(sql, [amount, userId]);
      
      const historySql = `
        INSERT INTO credit_transactions 
        (user_id, amount, balance_after, transaction_type, description, created_at) 
        VALUES (?, ?, ?, 'storage_upload', ?, NOW())
      `;
      const newBalance = userCredits - amount;
      await dbConnection.query(historySql, [userId, -amount, newBalance, description]);
      
      logger.info('扣除用户积分成功', { userId, amount, description });
      return true;
    } catch (error) {
      logger.error('扣除积分失败:', error);
      return false;
    }
  }
}

module.exports = StorageController;
