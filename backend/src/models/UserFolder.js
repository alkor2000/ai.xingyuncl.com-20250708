/**
 * 用户文件夹模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class UserFolder {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.parent_id = data.parent_id || null;
    this.name = data.name || '';
    this.path = data.path || '';
    this.is_deleted = data.is_deleted || false;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 创建文件夹
   */
  static async create(folderData) {
    try {
      // 生成路径
      let path = `/${folderData.name}`;
      if (folderData.parent_id) {
        const parent = await UserFolder.findById(folderData.parent_id);
        if (parent) {
          path = `${parent.path}/${folderData.name}`;
        }
      }
      
      const sql = `
        INSERT INTO user_folders (user_id, parent_id, name, path)
        VALUES (?, ?, ?, ?)
      `;
      
      const params = [
        folderData.user_id,
        folderData.parent_id || null,
        folderData.name,
        path
      ];
      
      const result = await dbConnection.query(sql, params);
      const folderId = result.rows.insertId;
      
      // 更新用户文件夹统计
      await UserFolder.updateFolderCount(folderData.user_id, 1);
      
      logger.info('文件夹创建成功', {
        folderId,
        userId: folderData.user_id,
        name: folderData.name
      });
      
      return await UserFolder.findById(folderId);
    } catch (error) {
      logger.error('创建文件夹失败:', error);
      throw new DatabaseError('创建文件夹失败', error);
    }
  }

  /**
   * 根据ID查找文件夹
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM user_folders WHERE id = ? AND is_deleted = 0';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new UserFolder(rows[0]);
    } catch (error) {
      logger.error('查找文件夹失败:', error);
      throw new DatabaseError('查找文件夹失败', error);
    }
  }

  /**
   * 获取用户文件夹列表
   */
  static async getUserFolders(userId, parentId = null) {
    try {
      let sql = `
        SELECT * FROM user_folders 
        WHERE user_id = ? AND is_deleted = 0
      `;
      
      const params = [userId];
      
      if (parentId === null) {
        sql += ' AND parent_id IS NULL';
      } else {
        sql += ' AND parent_id = ?';
        params.push(parentId);
      }
      
      sql += ' ORDER BY name ASC';
      
      const { rows } = await dbConnection.query(sql, params);
      
      return rows.map(row => new UserFolder(row));
    } catch (error) {
      logger.error('获取用户文件夹列表失败:', error);
      throw new DatabaseError('获取文件夹列表失败', error);
    }
  }

  /**
   * 获取文件夹树形结构
   */
  static async getFolderTree(userId) {
    try {
      const sql = `
        SELECT * FROM user_folders 
        WHERE user_id = ? AND is_deleted = 0
        ORDER BY parent_id, name
      `;
      
      const { rows } = await dbConnection.query(sql, [userId]);
      
      // 构建树形结构
      const tree = [];
      const map = {};
      
      // 先创建所有节点的映射
      rows.forEach(row => {
        map[row.id] = {
          ...row,
          children: []
        };
      });
      
      // 构建树
      rows.forEach(row => {
        if (row.parent_id === null) {
          tree.push(map[row.id]);
        } else if (map[row.parent_id]) {
          map[row.parent_id].children.push(map[row.id]);
        }
      });
      
      return tree;
    } catch (error) {
      logger.error('获取文件夹树失败:', error);
      throw new DatabaseError('获取文件夹树失败', error);
    }
  }

  /**
   * 更新文件夹统计
   */
  static async updateFolderCount(userId, change) {
    try {
      const sql = `
        UPDATE user_storage 
        SET folder_count = GREATEST(0, folder_count + ?)
        WHERE user_id = ?
      `;
      
      await dbConnection.query(sql, [change, userId]);
    } catch (error) {
      logger.error('更新文件夹统计失败:', error);
    }
  }

  /**
   * 软删除文件夹（包括子文件夹和文件）
   */
  async softDelete() {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      // 获取所有子文件夹ID
      const childFolderIds = await this.getAllChildFolderIds(transaction);
      childFolderIds.push(this.id);
      
      // 软删除所有相关文件
      const fileSql = `
        UPDATE user_files 
        SET is_deleted = 1, deleted_at = NOW()
        WHERE folder_id IN (${childFolderIds.map(() => '?').join(',')})
      `;
      
      await transaction.query(fileSql, childFolderIds);
      
      // 软删除所有文件夹
      const folderSql = `
        UPDATE user_folders 
        SET is_deleted = 1
        WHERE id IN (${childFolderIds.map(() => '?').join(',')})
      `;
      
      await transaction.query(folderSql, childFolderIds);
      
      // 更新统计
      await UserFolder.updateFolderCount(this.user_id, -childFolderIds.length);
      
      await transaction.commit();
      
      logger.info('文件夹及内容软删除成功', {
        folderId: this.id,
        deletedFolders: childFolderIds.length
      });
      
      return true;
    } catch (error) {
      await transaction.rollback();
      logger.error('软删除文件夹失败:', error);
      throw new DatabaseError('删除文件夹失败', error);
    }
  }

  /**
   * 获取所有子文件夹ID
   */
  async getAllChildFolderIds(transaction = null) {
    const conn = transaction || dbConnection;
    const childIds = [];
    
    const sql = 'SELECT id FROM user_folders WHERE parent_id = ? AND is_deleted = 0';
    const { rows } = await conn.query(sql, [this.id]);
    
    for (const row of rows) {
      childIds.push(row.id);
      const folder = new UserFolder(row);
      const grandChildIds = await folder.getAllChildFolderIds(conn);
      childIds.push(...grandChildIds);
    }
    
    return childIds;
  }

  /**
   * 检查文件夹所有权
   */
  static async checkOwnership(folderId, userId) {
    try {
      const sql = 'SELECT user_id FROM user_folders WHERE id = ? AND is_deleted = 0';
      const { rows } = await dbConnection.query(sql, [folderId]);
      
      if (rows.length === 0) {
        return false;
      }
      
      return rows[0].user_id === userId;
    } catch (error) {
      logger.error('检查文件夹所有权失败:', error);
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
      parent_id: this.parent_id,
      name: this.name,
      path: this.path,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = UserFolder;
