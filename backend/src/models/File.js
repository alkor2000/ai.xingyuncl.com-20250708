/**
 * 文件数据模型
 * 管理上传的文件信息
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

class File {
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
    
    // 计算属性 - 生成完整URL
    if (this.file_path) {
      // 智能处理不同环境的路径
      let urlPath = this.file_path;
      
      // 移除所有可能的根路径前缀
      const pathPrefixes = [
        '/app/storage/uploads',           // Docker容器内路径
        '/var/www/ai-platform/storage/uploads',  // PM2生产环境路径
        '/app/storage',                   // Docker存储根路径
        '/var/www/ai-platform/storage',   // PM2存储根路径
        '/storage/uploads',                // 相对存储路径
        '/storage',                        // 存储根路径
        'storage/uploads',                 // 无斜杠开头的相对路径
        'storage'                          // 无斜杠开头的存储根路径
      ];
      
      // 按长度排序，先匹配长的路径
      pathPrefixes.sort((a, b) => b.length - a.length);
      
      for (const prefix of pathPrefixes) {
        if (urlPath.startsWith(prefix)) {
          // 获取去掉前缀后的路径
          urlPath = urlPath.substring(prefix.length);
          break;
        }
      }
      
      // 确保路径以/开头
      if (!urlPath.startsWith('/')) {
        urlPath = '/' + urlPath;
      }
      
      // 如果路径不是以/uploads开头，添加它
      if (!urlPath.startsWith('/uploads')) {
        // 如果路径以/开头但不是/uploads，说明可能是子目录
        if (urlPath.startsWith('/')) {
          urlPath = '/uploads' + urlPath;
        } else {
          urlPath = '/uploads/' + urlPath;
        }
      }
      
      // 生成完整URL - 根据环境使用正确的协议
      const protocol = config.app.env === 'production' || config.app.domain.includes('nebulink') ? 'https' : 'http';
      this.url = `${protocol}://${config.app.domain}${urlPath}`;
      
      // 调试日志（仅开发环境）
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
        logger.debug('文件URL生成', {
          原始路径: data.file_path,
          处理后路径: urlPath,
          完整URL: this.url
        });
      }
    } else {
      this.url = null;
    }
  }

  /**
   * 创建文件记录
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
        path,
        url
      } = fileData;
      
      const id = uuidv4();
      
      const sql = `
        INSERT INTO files (
          id, 
          user_id, 
          conversation_id,
          original_name, 
          stored_name, 
          file_path, 
          file_size, 
          mime_type,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await dbConnection.query(sql, [
        id,
        user_id,
        conversation_id || null,
        original_name,
        filename,  // filename 映射到 stored_name
        path,      // path 映射到 file_path
        size,      // size 映射到 file_size
        mime_type,
        'ready'
      ]);
      
      logger.info('文件记录创建成功', {
        fileId: id,
        userId: user_id,
        filename
      });
      
      return await File.findById(id);
    } catch (error) {
      logger.error('创建文件记录失败:', error);
      throw new DatabaseError(`创建文件记录失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID查找文件
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
   * 检查文件所有权
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
   * 转换为JSON
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
