/**
 * 用户文件模型 - 增强版
 * 管理用户上传到OSS的文件，支持上传者记录
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class UserFile {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.uploaded_by = data.uploaded_by || null;
    this.folder_id = data.folder_id || null;
    this.original_name = data.original_name || '';
    this.stored_name = data.stored_name || '';
    this.oss_key = data.oss_key || '';
    this.oss_url = data.oss_url || '';
    this.file_size = data.file_size || 0;
    this.mime_type = data.mime_type || '';
    this.file_ext = data.file_ext || '';
    this.thumbnail_url = data.thumbnail_url || null;
    this.is_public = data.is_public || false;
    this.download_count = data.download_count || 0;
    this.is_deleted = data.is_deleted || false;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 创建文件记录
   */
  static async create(fileData) {
    try {
      const sql = `
        INSERT INTO user_files (
          user_id, uploaded_by, folder_id, original_name, stored_name, oss_key,
          oss_url, file_size, mime_type, file_ext, thumbnail_url, is_public
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        fileData.user_id,
        fileData.uploaded_by || fileData.user_id, // 如果没有指定上传者，默认为user_id
        fileData.folder_id || null,
        fileData.original_name,
        fileData.stored_name,
        fileData.oss_key,
        fileData.oss_url,
        fileData.file_size,
        fileData.mime_type,
        fileData.file_ext,
        fileData.thumbnail_url || null,
        fileData.is_public || false
      ];
      
      const result = await dbConnection.query(sql, params);
      
      // 正确访问insertId
      const fileId = result.rows.insertId;
      
      // 更新用户存储统计
      await UserFile.updateUserStorage(fileData.user_id, fileData.file_size, 1);
      
      logger.info('文件记录创建成功', {
        fileId,
        userId: fileData.user_id,
        uploadedBy: fileData.uploaded_by,
        fileName: fileData.original_name
      });
      
      return await UserFile.findById(fileId);
    } catch (error) {
      logger.error('创建文件记录失败:', error);
      throw new DatabaseError('创建文件记录失败', error);
    }
  }

  /**
   * 根据ID查找文件
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM user_files WHERE id = ? AND is_deleted = 0';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new UserFile(rows[0]);
    } catch (error) {
      logger.error('查找文件失败:', error);
      throw new DatabaseError('查找文件失败', error);
    }
  }

  /**
   * 获取用户文件列表 - 增强版，支持特殊文件夹
   */
  static async getUserFiles(userId, folderId = null, options = {}) {
    try {
      const { page = 1, limit = 50, orderBy = 'created_at', order = 'DESC', userGroupId, userRole } = options;
      const offset = (page - 1) * limit;
      
      // 验证排序字段，防止SQL注入
      const validOrderFields = ['id', 'original_name', 'file_size', 'created_at', 'updated_at'];
      const safeOrderBy = validOrderFields.includes(orderBy) ? orderBy : 'created_at';
      
      // 验证排序方向
      const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      // 验证分页参数
      const safeLimit = parseInt(limit) || 50;
      const safeOffset = parseInt(offset) || 0;
      
      let sqlParts = [];
      let params = [];
      
      // 如果指定了文件夹
      if (folderId !== null && folderId !== undefined && folderId !== 'null') {
        // 先获取文件夹信息
        const folderSql = 'SELECT folder_type, group_id FROM user_folders WHERE id = ?';
        const folderResult = await dbConnection.query(folderSql, [folderId]);
        
        if (folderResult.rows.length > 0) {
          const folder = folderResult.rows[0];
          
          // 根据文件夹类型构建查询
          if (folder.folder_type === 'global') {
            // 全局文件夹：显示所有文件
            sqlParts = ['SELECT * FROM user_files WHERE folder_id = ? AND is_deleted = 0'];
            params = [folderId];
          } else if (folder.folder_type === 'group') {
            // 组织文件夹：显示组内所有文件（需要验证用户是否属于该组）
            if (userGroupId === folder.group_id) {
              sqlParts = ['SELECT * FROM user_files WHERE folder_id = ? AND is_deleted = 0'];
              params = [folderId];
            } else {
              // 用户不属于该组，返回空结果
              return {
                files: [],
                pagination: {
                  page: parseInt(page),
                  limit: parseInt(limit),
                  total: 0,
                  pages: 0
                }
              };
            }
          } else {
            // 个人文件夹：只显示用户自己的文件
            sqlParts = ['SELECT * FROM user_files WHERE user_id = ? AND folder_id = ? AND is_deleted = 0'];
            params = [userId, folderId];
          }
        } else {
          // 文件夹不存在
          sqlParts = ['SELECT * FROM user_files WHERE user_id = ? AND folder_id = ? AND is_deleted = 0'];
          params = [userId, folderId];
        }
      } else {
        // 根目录：只显示用户个人文件
        sqlParts = ['SELECT * FROM user_files WHERE user_id = ? AND folder_id IS NULL AND is_deleted = 0'];
        params = [userId];
      }
      
      // 添加排序和分页
      sqlParts.push(`ORDER BY \`${safeOrderBy}\` ${safeOrder}`);
      sqlParts.push(`LIMIT ${safeLimit} OFFSET ${safeOffset}`);
      
      const sql = sqlParts.join(' ');
      const { rows } = await dbConnection.query(sql, params);
      
      // 获取总数
      let countSqlParts = [];
      let countParams = [];
      
      if (folderId !== null && folderId !== undefined && folderId !== 'null') {
        const folderSql = 'SELECT folder_type, group_id FROM user_folders WHERE id = ?';
        const folderResult = await dbConnection.query(folderSql, [folderId]);
        
        if (folderResult.rows.length > 0) {
          const folder = folderResult.rows[0];
          
          if (folder.folder_type === 'global' || (folder.folder_type === 'group' && userGroupId === folder.group_id)) {
            countSqlParts = ['SELECT COUNT(*) as total FROM user_files WHERE folder_id = ? AND is_deleted = 0'];
            countParams = [folderId];
          } else if (folder.folder_type === 'group' && userGroupId !== folder.group_id) {
            // 用户不属于该组
            return {
              files: [],
              pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: 0,
                pages: 0
              }
            };
          } else {
            countSqlParts = ['SELECT COUNT(*) as total FROM user_files WHERE user_id = ? AND folder_id = ? AND is_deleted = 0'];
            countParams = [userId, folderId];
          }
        } else {
          countSqlParts = ['SELECT COUNT(*) as total FROM user_files WHERE user_id = ? AND folder_id = ? AND is_deleted = 0'];
          countParams = [userId, folderId];
        }
      } else {
        countSqlParts = ['SELECT COUNT(*) as total FROM user_files WHERE user_id = ? AND folder_id IS NULL AND is_deleted = 0'];
        countParams = [userId];
      }
      
      const countSql = countSqlParts.join(' ');
      const countResult = await dbConnection.query(countSql, countParams);
      const total = countResult.rows[0]?.total || 0;
      
      return {
        files: rows.map(row => new UserFile(row)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户文件列表失败:', error);
      throw new DatabaseError('获取文件列表失败', error);
    }
  }

  /**
   * 更新用户存储统计
   */
  static async updateUserStorage(userId, sizeChange, fileCountChange = 0) {
    try {
      // 检查是否存在记录
      const checkSql = 'SELECT id FROM user_storage WHERE user_id = ?';
      const { rows } = await dbConnection.query(checkSql, [userId]);
      
      if (rows.length === 0) {
        // 创建新记录
        const insertSql = `
          INSERT INTO user_storage (user_id, storage_used, file_count)
          VALUES (?, ?, ?)
        `;
        await dbConnection.query(insertSql, [userId, Math.max(0, sizeChange), Math.max(0, fileCountChange)]);
      } else {
        // 更新现有记录
        const updateSql = `
          UPDATE user_storage 
          SET storage_used = GREATEST(0, storage_used + ?),
              file_count = GREATEST(0, file_count + ?)
          WHERE user_id = ?
        `;
        await dbConnection.query(updateSql, [sizeChange, fileCountChange, userId]);
      }
    } catch (error) {
      logger.error('更新用户存储统计失败:', error);
    }
  }

  /**
   * 软删除文件
   */
  async softDelete() {
    try {
      const sql = `
        UPDATE user_files 
        SET is_deleted = 1, deleted_at = NOW() 
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [this.id]);
      
      // 更新用户存储统计
      await UserFile.updateUserStorage(this.user_id, -this.file_size, -1);
      
      logger.info('文件软删除成功', { fileId: this.id });
      
      return true;
    } catch (error) {
      logger.error('软删除文件失败:', error);
      throw new DatabaseError('删除文件失败', error);
    }
  }

  /**
   * 移动文件到其他文件夹
   */
  async moveTo(targetFolderId) {
    try {
      const sql = 'UPDATE user_files SET folder_id = ? WHERE id = ?';
      await dbConnection.query(sql, [targetFolderId, this.id]);
      
      this.folder_id = targetFolderId;
      
      logger.info('文件移动成功', {
        fileId: this.id,
        targetFolderId
      });
      
      return true;
    } catch (error) {
      logger.error('移动文件失败:', error);
      throw new DatabaseError('移动文件失败', error);
    }
  }

  /**
   * 检查文件所有权
   */
  static async checkOwnership(fileId, userId) {
    try {
      const sql = 'SELECT user_id FROM user_files WHERE id = ? AND is_deleted = 0';
      const { rows } = await dbConnection.query(sql, [fileId]);
      
      if (rows.length === 0) {
        return false;
      }
      
      return rows[0].user_id === userId;
    } catch (error) {
      logger.error('检查文件所有权失败:', error);
      return false;
    }
  }

  /**
   * 获取用户存储信息
   */
  static async getUserStorage(userId) {
    try {
      const sql = 'SELECT * FROM user_storage WHERE user_id = ?';
      const { rows } = await dbConnection.query(sql, [userId]);
      
      if (rows.length === 0) {
        // 返回默认值
        return {
          storage_quota: 10737418240, // 10GB
          storage_used: 0,
          file_count: 0,
          folder_count: 0
        };
      }
      
      return rows[0];
    } catch (error) {
      logger.error('获取用户存储信息失败:', error);
      throw new DatabaseError('获取存储信息失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      uploaded_by: this.uploaded_by,
      folder_id: this.folder_id,
      original_name: this.original_name,
      stored_name: this.stored_name,
      oss_key: this.oss_key,
      oss_url: this.oss_url,
      file_size: this.file_size,
      mime_type: this.mime_type,
      file_ext: this.file_ext,
      thumbnail_url: this.thumbnail_url,
      is_public: this.is_public,
      download_count: this.download_count,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = UserFile;
