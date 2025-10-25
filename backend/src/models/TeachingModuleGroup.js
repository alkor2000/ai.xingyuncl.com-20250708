/**
 * 教学模块分组模型
 * 管理教学模块的分组功能（支持多对多关系）
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class TeachingModuleGroup {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || null;
    this.sort_order = data.sort_order || 0;
    this.is_active = data.is_active !== undefined ? data.is_active : true;
    this.visibility = data.visibility || 'public';
    this.owner_group_id = data.owner_group_id || null;
    this.created_by = data.created_by || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.module_count = data.module_count || 0;
  }

  /**
   * 创建分组
   */
  static async create(groupData) {
    try {
      const {
        name,
        description = null,
        sort_order = 0,
        is_active = true,
        visibility = 'public',
        owner_group_id = null,
        created_by
      } = groupData;

      if (!name || !created_by) {
        throw new ValidationError('分组名称和创建者为必填项');
      }

      const sql = `
        INSERT INTO teaching_module_groups (
          name, description, sort_order, is_active, visibility, 
          owner_group_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const params = [
        name, description, sort_order, is_active ? 1 : 0, 
        visibility, owner_group_id, created_by
      ];

      const { rows } = await dbConnection.query(sql, params);
      const groupId = rows.insertId;

      logger.info('教学模块分组创建成功', { groupId, name, created_by });

      return await TeachingModuleGroup.findById(groupId);
    } catch (error) {
      logger.error('创建教学模块分组失败:', error);
      throw new DatabaseError('创建分组失败', error);
    }
  }

  /**
   * 根据ID查找分组
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT 
          tmg.*,
          u.username as creator_name,
          (SELECT COUNT(*) FROM teaching_module_group_relations WHERE group_id = tmg.id) as module_count
        FROM teaching_module_groups tmg
        LEFT JOIN users u ON tmg.created_by = u.id
        WHERE tmg.id = ?
      `;

      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) {
        return null;
      }

      return new TeachingModuleGroup(rows[0]);
    } catch (error) {
      logger.error('查找教学模块分组失败:', error);
      throw new DatabaseError('查找分组失败', error);
    }
  }

  /**
   * 获取所有分组列表
   */
  static async getAll(options = {}) {
    try {
      const {
        is_active = null,
        include_module_count = true
      } = options;

      let whereConditions = [];
      let params = [];

      if (is_active !== null) {
        whereConditions.push('tmg.is_active = ?');
        params.push(is_active ? 1 : 0);
      }

      const whereClause = whereConditions.length > 0 
        ? 'WHERE ' + whereConditions.join(' AND ')
        : '';

      const sql = `
        SELECT 
          tmg.*,
          u.username as creator_name
          ${include_module_count ? ', (SELECT COUNT(*) FROM teaching_module_group_relations WHERE group_id = tmg.id) as module_count' : ''}
        FROM teaching_module_groups tmg
        LEFT JOIN users u ON tmg.created_by = u.id
        ${whereClause}
        ORDER BY tmg.sort_order ASC, tmg.created_at DESC
      `;

      const { rows } = await dbConnection.query(sql, params);

      return rows.map(row => new TeachingModuleGroup(row));
    } catch (error) {
      logger.error('获取教学模块分组列表失败:', error);
      throw new DatabaseError('获取分组列表失败', error);
    }
  }

  /**
   * 更新分组信息
   */
  async update(updateData) {
    try {
      const allowedFields = [
        'name', 'description', 'sort_order', 'is_active', 
        'visibility', 'owner_group_id'
      ];

      const updateFields = Object.keys(updateData).filter(field =>
        allowedFields.includes(field)
      );

      if (updateFields.length === 0) {
        return this;
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => updateData[field]);
      values.push(this.id);

      const sql = `UPDATE teaching_module_groups SET ${setClause}, updated_at = NOW() WHERE id = ?`;
      await dbConnection.query(sql, values);

      // 更新实例属性
      updateFields.forEach(field => {
        this[field] = updateData[field];
      });

      logger.info('教学模块分组更新成功', { groupId: this.id, updatedFields: updateFields });

      return this;
    } catch (error) {
      logger.error('更新教学模块分组失败:', error);
      throw new DatabaseError('更新分组失败', error);
    }
  }

  /**
   * 删除分组（会同时删除关联关系）
   */
  async delete() {
    try {
      const sql = 'DELETE FROM teaching_module_groups WHERE id = ?';
      await dbConnection.query(sql, [this.id]);

      logger.info('教学模块分组删除成功', { groupId: this.id });

      return true;
    } catch (error) {
      logger.error('删除教学模块分组失败:', error);
      throw new DatabaseError('删除分组失败', error);
    }
  }

  /**
   * 添加模块到分组
   */
  static async addModuleToGroup(moduleId, groupId, sortOrder = 0) {
    try {
      const sql = `
        INSERT INTO teaching_module_group_relations (module_id, group_id, sort_order, created_at)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
      `;

      await dbConnection.query(sql, [moduleId, groupId, sortOrder]);

      logger.info('模块添加到分组成功', { moduleId, groupId });

      return true;
    } catch (error) {
      logger.error('添加模块到分组失败:', error);
      throw new DatabaseError('添加模块到分组失败', error);
    }
  }

  /**
   * 从分组中移除模块
   */
  static async removeModuleFromGroup(moduleId, groupId) {
    try {
      const sql = 'DELETE FROM teaching_module_group_relations WHERE module_id = ? AND group_id = ?';
      await dbConnection.query(sql, [moduleId, groupId]);

      logger.info('从分组移除模块成功', { moduleId, groupId });

      return true;
    } catch (error) {
      logger.error('从分组移除模块失败:', error);
      throw new DatabaseError('从分组移除模块失败', error);
    }
  }

  /**
   * 批量设置模块的分组
   */
  static async setModuleGroups(moduleId, groupIds = []) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      // 先删除模块的所有分组关系
      const deleteSql = 'DELETE FROM teaching_module_group_relations WHERE module_id = ?';
      await transaction.query(deleteSql, [moduleId]);

      // 再添加新的分组关系
      if (groupIds.length > 0) {
        const insertSql = `
          INSERT INTO teaching_module_group_relations (module_id, group_id, sort_order, created_at)
          VALUES (?, ?, ?, NOW())
        `;
        
        for (let i = 0; i < groupIds.length; i++) {
          await transaction.query(insertSql, [moduleId, groupIds[i], i]);
        }
      }

      await transaction.commit();

      logger.info('批量设置模块分组成功', { moduleId, groupIds });

      return true;
    } catch (error) {
      await transaction.rollback();
      logger.error('批量设置模块分组失败:', error);
      throw new DatabaseError('批量设置模块分组失败', error);
    }
  }

  /**
   * 获取模块的所有分组
   */
  static async getModuleGroups(moduleId) {
    try {
      const sql = `
        SELECT tmg.*, tmgr.sort_order as relation_sort_order
        FROM teaching_module_groups tmg
        INNER JOIN teaching_module_group_relations tmgr ON tmg.id = tmgr.group_id
        WHERE tmgr.module_id = ?
        ORDER BY tmgr.sort_order ASC
      `;

      const { rows } = await dbConnection.query(sql, [moduleId]);

      return rows.map(row => new TeachingModuleGroup(row));
    } catch (error) {
      logger.error('获取模块分组失败:', error);
      throw new DatabaseError('获取模块分组失败', error);
    }
  }

  /**
   * 获取分组的所有模块（含模块详情）
   */
  static async getGroupModules(groupId) {
    try {
      const sql = `
        SELECT 
          tm.*,
          u.username as creator_name,
          tmgr.sort_order as relation_sort_order
        FROM teaching_modules tm
        INNER JOIN teaching_module_group_relations tmgr ON tm.id = tmgr.module_id
        LEFT JOIN users u ON tm.creator_id = u.id
        WHERE tmgr.group_id = ? AND tm.is_deleted = 0
        ORDER BY tmgr.sort_order ASC, tm.created_at DESC
      `;

      const { rows } = await dbConnection.query(sql, [groupId]);

      return rows;
    } catch (error) {
      logger.error('获取分组模块失败:', error);
      throw new DatabaseError('获取分组模块失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      sort_order: this.sort_order,
      is_active: this.is_active,
      visibility: this.visibility,
      owner_group_id: this.owner_group_id,
      created_by: this.created_by,
      creator_name: this.creator_name,
      module_count: this.module_count,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = TeachingModuleGroup;
