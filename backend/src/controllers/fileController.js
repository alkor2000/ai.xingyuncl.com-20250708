/**
 * 文件上传控制器
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const dbConnection = require('../database/connection');
const config = require('../config');

// 配置存储
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const uploadPath = path.join(config.upload.path, getUploadDir(file.mimetype));
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

// 文件过滤
const fileFilter = (req, file, cb) => {
  const allowedTypes = config.upload.allowedMimeTypes;
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
};

// 创建multer实例
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSize,
    files: 5
  }
});

// 根据MIME类型获取上传目录
function getUploadDir(mimetype) {
  if (mimetype.startsWith('image/')) {
    return 'images';
  } else if (mimetype.includes('document') || mimetype === 'application/pdf') {
    return 'documents';
  } else {
    return 'others';
  }
}

class FileController {
  /**
   * 获取multer中间件
   */
  static getUploadMiddleware() {
    return upload.array('files', 5);
  }

  /**
   * 上传文件
   * POST /api/files/upload
   */
  static async uploadFiles(req, res) {
    try {
      const userId = req.user.id;
      const files = req.files;

      if (!files || files.length === 0) {
        return ResponseHelper.validation(res, ['请选择要上传的文件']);
      }

      const uploadedFiles = [];

      for (const file of files) {
        // 计算相对路径
        const relativePath = path.relative(config.upload.path, file.path);
        
        // 保存文件信息到数据库
        const sql = `
          INSERT INTO files (id, user_id, original_name, filename, mime_type, size, path, upload_ip) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const fileId = uuidv4();
        
        await dbConnection.query(sql, [
          fileId,
          userId,
          file.originalname,
          file.filename,
          file.mimetype,
          file.size,
          relativePath,
          req.ip
        ]);

        uploadedFiles.push({
          id: fileId,
          original_name: file.originalname,
          filename: file.filename,
          mime_type: file.mimetype,
          size: file.size,
          url: `/uploads/${relativePath.replace(/\\/g, '/')}`
        });

        logger.info('文件上传成功', {
          fileId,
          userId,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype
        });
      }

      return ResponseHelper.success(res, uploadedFiles, '文件上传成功');
    } catch (error) {
      logger.error('文件上传失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '文件上传失败');
    }
  }

  /**
   * 获取用户文件列表
   * GET /api/files
   */
  static async getUserFiles(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, type = null } = req.query;

      let whereClause = 'WHERE user_id = ?';
      const params = [userId];

      if (type) {
        whereClause += ' AND mime_type LIKE ?';
        params.push(`${type}%`);
      }

      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM files ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      // 获取文件列表
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT id, original_name, filename, mime_type, size, path, created_at
        FROM files ${whereClause} 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `;

      const { rows } = await dbConnection.query(listSql, [...params, limit, offset]);

      // 添加访问URL
      const files = rows.map(file => ({
        ...file,
        url: `/uploads/${file.path.replace(/\\/g, '/')}`
      }));

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      };

      return ResponseHelper.paginated(res, files, pagination, '获取文件列表成功');
    } catch (error) {
      logger.error('获取文件列表失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取文件列表失败');
    }
  }

  /**
   * 删除文件
   * DELETE /api/files/:id
   */
  static async deleteFile(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 查找文件
      const { rows } = await dbConnection.query(
        'SELECT * FROM files WHERE id = ? AND user_id = ?',
        [id, userId]
      );

      if (rows.length === 0) {
        return ResponseHelper.notFound(res, '文件不存在');
      }

      const file = rows[0];

      // 删除物理文件
      try {
        const filePath = path.join(config.upload.path, file.path);
        await fs.unlink(filePath);
      } catch (error) {
        logger.warn('删除物理文件失败', { 
          fileId: id, 
          path: file.path, 
          error: error.message 
        });
      }

      // 删除数据库记录
      await dbConnection.query('DELETE FROM files WHERE id = ?', [id]);

      logger.info('文件删除成功', { 
        fileId: id, 
        userId,
        originalName: file.original_name 
      });

      return ResponseHelper.success(res, null, '文件删除成功');
    } catch (error) {
      logger.error('文件删除失败', { 
        fileId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '文件删除失败');
    }
  }

  /**
   * 获取文件信息
   * GET /api/files/:id
   */
  static async getFileInfo(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { rows } = await dbConnection.query(
        'SELECT * FROM files WHERE id = ? AND user_id = ?',
        [id, userId]
      );

      if (rows.length === 0) {
        return ResponseHelper.notFound(res, '文件不存在');
      }

      const file = rows[0];
      file.url = `/uploads/${file.path.replace(/\\/g, '/')}`;

      return ResponseHelper.success(res, file, '获取文件信息成功');
    } catch (error) {
      logger.error('获取文件信息失败', { 
        fileId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取文件信息失败');
    }
  }
}

module.exports = FileController;
