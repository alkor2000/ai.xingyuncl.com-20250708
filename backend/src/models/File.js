/**
 * 文件数据模型
 * 管理上传的文件信息（图片、文档等）
 * 
 * v2.0 变更：
 *   - 新增 findByIds(ids) 批量查询方法，支持多图上传场景
 *   - 新增 checkOwnershipBatch(fileIds, userId) 批量权限校验
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

class File {
  /**
   * 构造函数 - 初始化文件对象，自动计算公开访问 URL
   * @param {Object} data - 数据库行数据
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.conversation_id = data.conversation_id || null;
    this.original_name = data.original_name || null;
    this.stored_name = data.stored_name || null;
    this.file_path = data.file_path || null;
    this.file_size = data.file_size || 0;
    this.mime_type = data.mime_type || null;
    this.extracted_content = data.extracted_content || null;
    this.status = data.status || 'ready';
    this.created_at = data.created_at || null;
    
    // 计算属性 - 根据 file_path 生成完整的公开访问 URL
    if (this.file_path) {
      this.url = File._buildUrl(this.file_path);
    } else {
      this.url = null;
    }
  }

  /**
   * 内部方法：根据磁盘路径生成公开访问 URL
   * 智能处理 Docker 容器路径和 PM2 生产环境路径
   * @param {string} filePath - 文件的磁盘绝对路径
   * @returns {string} 完整的公开访问 URL
   */
  static _buildUrl(filePath) {
    let urlPath = filePath;
    
    // 移除所有可能的根路径前缀（按长度降序匹配，确保最长前缀优先）
    const pathPrefixes = [
      '/app/storage/uploads',                    // Docker容器内路径
      '/var/www/ai-platform/storage/uploads',    // PM2生产环境路径
      '/app/storage',                            // Docker存储根路径
      '/var/www/ai-platform/storage',            // PM2存储根路径
      '/storage/uploads',                        // 相对存储路径
      '/storage',                                // 存储根路径
      'storage/uploads',                         // 无斜杠相对路径
      'storage'                                  // 无斜杠存储根路径
    ];
    
    // 按长度降序排列，先匹配最长的前缀
    pathPrefixes.sort((a, b) => b.length - a.length);
    
    for (const prefix of pathPrefixes) {
      if (urlPath.startsWith(prefix)) {
        urlPath = urlPath.substring(prefix.length);
        break;
      }
    }
    
    // 确保路径以 / 开头
    if (!urlPath.startsWith('/')) {
      urlPath = '/' + urlPath;
    }
    
    // 如果路径不是以 /uploads 开头，补上
    if (!urlPath.startsWith('/uploads')) {
      urlPath = '/uploads' + urlPath;
    }
    
    // 根据环境确定协议
    const protocol = config.app.env === 'production' || config.app.domain.includes('nebulink') ? 'https' : 'http';
    return `${protocol}://${config.app.domain}${urlPath}`;
  }

  /**
   * 创建文件记录
   * @param {Object} fileData - 文件数据
   * @param {number} fileData.user_id - 用户ID
   * @param {string} fileData.conversation_id - 会话ID（可选）
   * @param {string} fileData.filename - 存储的文件名
   * @param {string} fileData.original_name - 原始文件名
   * @param {string} fileData.mime_type - MIME类型
   * @param {number} fileData.size - 文件大小（字节）
   * @param {string} fileData.path - 磁盘存储路径
   * @returns {File} 创建的文件对象
   */
  static async create(fileData) {
    try {
      const {
        user_id,
        conversation_id,
        filename,
        original_name,
        mime_type,
        size,
        path: filePath,
        url
      } = fileData;
      
      const id = uuidv4();
      
      const sql = `
        INSERT INTO files (
          id, user_id, conversation_id,
          original_name, stored_name, file_path,
          file_size, mime_type, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await dbConnection.query(sql, [
        id,
        user_id,
        conversation_id || null,
        original_name,
        filename,
        filePath,
        size,
        mime_type,
        'ready'
      ]);
      
      logger.info('文件记录创建成功', { fileId: id, userId: user_id, filename });
      
      return await File.findById(id);
    } catch (error) {
      logger.error('创建文件记录失败:', error);
      throw new DatabaseError(`创建文件记录失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID查找单个文件
   * @param {string} id - 文件UUID
   * @returns {File|null} 文件对象，未找到返回 null
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM files WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new File(rows[0]);
    } catch (error) {
      logger.error('查找文件失败:', error);
      throw new DatabaseError(`查找文件失败: ${error.message}`, error);
    }
  }

  /**
   * v2.0 新增：根据多个ID批量查找文件
   * 使用 IN 查询一次获取所有文件，避免 N+1 查询问题
   * 返回结果保持传入的 ID 顺序
   * 
   * @param {string[]} ids - 文件ID数组
   * @returns {File[]} 文件对象数组（按传入顺序排列）
   */
  static async findByIds(ids) {
    try {
      // 空数组直接返回
      if (!ids || ids.length === 0) {
        return [];
      }

      // 去重（保留原始顺序用于后续排序）
      const uniqueIds = [...new Set(ids)];

      // 使用 IN 查询批量获取
      const placeholders = uniqueIds.map(() => '?').join(',');
      const sql = `SELECT * FROM files WHERE id IN (${placeholders})`;
      const { rows } = await dbConnection.query(sql, uniqueIds);

      // 转换为 File 对象，放入 Map 便于按 ID 查找
      const fileMap = new Map();
      for (const row of rows) {
        fileMap.set(row.id, new File(row));
      }

      // 按原始 ids 顺序返回（保持调用者期望的顺序）
      const result = [];
      for (const id of ids) {
        const file = fileMap.get(id);
        if (file) {
          result.push(file);
        } else {
          logger.warn('批量查找文件：ID未找到', { fileId: id });
        }
      }

      logger.info('批量查找文件完成', {
        requestedCount: ids.length,
        uniqueCount: uniqueIds.length,
        foundCount: result.length
      });

      return result;
    } catch (error) {
      logger.error('批量查找文件失败:', error);
      throw new DatabaseError(`批量查找文件失败: ${error.message}`, error);
    }
  }

  /**
   * 检查单个文件的所有权
   * @param {string} fileId - 文件ID
   * @param {number} userId - 用户ID
   * @returns {boolean} 是否属于该用户
   */
  static async checkOwnership(fileId, userId) {
    try {
      const sql = 'SELECT user_id FROM files WHERE id = ?';
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
   * v2.0 新增：批量检查多个文件的所有权
   * 验证指定的所有文件都存在且都属于同一用户
   * 
   * @param {string[]} fileIds - 文件ID数组
   * @param {number} userId - 用户ID
   * @returns {boolean} 是否全部属于该用户（任一不满足即返回 false）
   */
  static async checkOwnershipBatch(fileIds, userId) {
    try {
      // 空数组视为通过
      if (!fileIds || fileIds.length === 0) {
        return true;
      }

      const uniqueIds = [...new Set(fileIds)];
      const placeholders = uniqueIds.map(() => '?').join(',');
      const sql = `SELECT id, user_id FROM files WHERE id IN (${placeholders})`;
      const { rows } = await dbConnection.query(sql, uniqueIds);

      // 检查是否所有文件都找到了
      if (rows.length !== uniqueIds.length) {
        const foundIds = new Set(rows.map(r => r.id));
        const missingIds = uniqueIds.filter(id => !foundIds.has(id));
        logger.warn('批量权限检查：部分文件不存在', {
          requested: uniqueIds.length,
          found: rows.length,
          missingIds
        });
        return false;
      }

      // 检查是否所有文件都属于该用户
      for (const row of rows) {
        if (row.user_id !== userId) {
          logger.warn('批量权限检查：文件所有权不匹配', {
            fileId: row.id,
            fileOwner: row.user_id,
            requestUser: userId
          });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('批量检查文件所有权失败:', error);
      return false;
    }
  }

  /**
   * 转换为JSON格式（用于API响应）
   * @returns {Object} 文件的JSON表示
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      filename: this.stored_name,
      original_name: this.original_name,
      mime_type: this.mime_type,
      size: this.file_size,
      url: this.url,
      created_at: this.created_at
    };
  }
}

module.exports = File;
