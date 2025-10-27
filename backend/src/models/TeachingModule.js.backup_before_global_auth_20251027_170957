/**
 * 教学模块模型
 * 管理教学模块的创建、查询、更新和权限控制
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class TeachingModule {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || null;
    this.cover_image = data.cover_image || null;
    this.creator_id = data.creator_id || null;
    this.owner_group_id = data.owner_group_id || null;
    this.visibility = data.visibility || 'private';
    this.status = data.status || 'draft';
    this.order_index = data.order_index || 0;
    this.lesson_count = data.lesson_count || 0;
    this.view_count = data.view_count || 0;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.published_at = data.published_at || null;
    this.is_deleted = data.is_deleted || false;
    this.deleted_at = data.deleted_at || null;
    this.deleted_by = data.deleted_by || null;
  }

  /**
   * 创建教学模块
   */
  static async create(moduleData) {
    try {
      const {
        name,
        description = null,
        cover_image = null,
        creator_id,
        owner_group_id = null,
        visibility = 'private',
        status = 'draft',
        order_index = 0
      } = moduleData;

      if (!name || !creator_id) {
        throw new ValidationError('模块名称和创建者为必填项');
      }

      const sql = `
        INSERT INTO teaching_modules (
          name, description, cover_image, creator_id, owner_group_id,
          visibility, status, order_index, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const params = [
        name, description, cover_image, creator_id, owner_group_id,
        visibility, status, order_index
      ];

      const { rows } = await dbConnection.query(sql, params);
      const moduleId = rows.insertId;

      logger.info('教学模块创建成功', {
        moduleId,
        name,
        creator_id,
        visibility
      });

      return await TeachingModule.findById(moduleId);
    } catch (error) {
      logger.error('创建教学模块失败:', error);
      throw new DatabaseError('创建教学模块失败', error);
    }
  }

  /**
   * 根据ID查找模块
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT tm.*,
               u.username as creator_name,
               ug.name as owner_group_name
        FROM teaching_modules tm
        LEFT JOIN users u ON tm.creator_id = u.id
        LEFT JOIN user_groups ug ON tm.owner_group_id = ug.id
        WHERE tm.id = ? AND tm.is_deleted = 0
      `;

      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) {
        return null;
      }

      return new TeachingModule(rows[0]);
    } catch (error) {
      logger.error('查找教学模块失败:', error);
      throw new DatabaseError('查找教学模块失败', error);
    }
  }

  /**
   * 获取用户可访问的模块列表（核心权限过滤）
   */
  static async getUserModules(userId, userRole, userGroupId, userTags = [], options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status = null,
        visibility = null,
        search = null
      } = options;

      const offset = (page - 1) * limit;
      let whereConditions = ['tm.is_deleted = 0'];
      let params = [];

      // 权限过滤逻辑
      if (userRole !== 'super_admin' && userRole !== 'admin') {
        // 普通用户权限过滤
        const tagIds = userTags.map(t => t.id);
        const tagPlaceholders = tagIds.length > 0 ? tagIds.map(() => '?').join(',') : 'NULL';

        whereConditions.push(`(
          tm.creator_id = ? OR
          tm.visibility = 'public' OR
          (tm.visibility = 'group' AND tm.owner_group_id = ?) OR
          EXISTS (
            SELECT 1 FROM teaching_permissions tp
            WHERE tp.module_id = tm.id
            AND (tp.expires_at IS NULL OR tp.expires_at > NOW())
            AND (
              tp.user_id = ? OR
              tp.group_id = ? OR
              (tp.tag_id IN (${tagPlaceholders}))
            )
          )
        )`);

        params.push(userId, userGroupId, userId, userGroupId, ...tagIds);
      }

      // 状态过滤
      if (status) {
        whereConditions.push('tm.status = ?');
        params.push(status);
      }

      // 可见性过滤
      if (visibility) {
        whereConditions.push('tm.visibility = ?');
        params.push(visibility);
      }

      // 搜索过滤
      if (search) {
        whereConditions.push('(tm.name LIKE ? OR tm.description LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM teaching_modules tm WHERE ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      // 获取列表
      const listSql = `
        SELECT tm.*,
               u.username as creator_name,
               ug.name as owner_group_name
        FROM teaching_modules tm
        LEFT JOIN users u ON tm.creator_id = u.id
        LEFT JOIN user_groups ug ON tm.owner_group_id = ug.id
        WHERE ${whereClause}
        ORDER BY tm.order_index ASC, tm.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const { rows: modules } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);

      return {
        modules: modules.map(m => new TeachingModule(m)),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户模块列表失败:', error);
      throw new DatabaseError('获取模块列表失败', error);
    }
  }

  /**
   * 更新模块信息
   */
  async update(updateData) {
    try {
      const allowedFields = [
        'name', 'description', 'cover_image', 'visibility',
        'status', 'order_index', 'owner_group_id'
      ];

      const updateFields = Object.keys(updateData).filter(field =>
        allowedFields.includes(field)
      );

      if (updateFields.length === 0) {
        return this;
      }

      // 如果状态变为published，设置发布时间
      if (updateData.status === 'published' && this.status !== 'published') {
        updateFields.push('published_at');
        updateData.published_at = new Date();
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => updateData[field]);
      values.push(this.id);

      const sql = `UPDATE teaching_modules SET ${setClause}, updated_at = NOW() WHERE id = ? AND is_deleted = 0`;
      await dbConnection.query(sql, values);

      // 更新实例属性
      updateFields.forEach(field => {
        this[field] = updateData[field];
      });

      logger.info('教学模块更新成功', { moduleId: this.id, updatedFields: updateFields });

      return this;
    } catch (error) {
      logger.error('更新教学模块失败:', error);
      throw new DatabaseError('更新教学模块失败', error);
    }
  }

  /**
   * 软删除模块
   */
  async softDelete(deletedBy) {
    try {
      const sql = `
        UPDATE teaching_modules 
        SET is_deleted = 1, deleted_at = NOW(), deleted_by = ?, status = 'archived'
        WHERE id = ? AND is_deleted = 0
      `;

      await dbConnection.query(sql, [deletedBy, this.id]);

      this.is_deleted = true;
      this.deleted_at = new Date();
      this.deleted_by = deletedBy;
      this.status = 'archived';

      logger.info('教学模块软删除成功', { moduleId: this.id, deletedBy });

      return true;
    } catch (error) {
      logger.error('软删除教学模块失败:', error);
      throw new DatabaseError('删除教学模块失败', error);
    }
  }

  /**
   * 增加查看次数
   */
  async incrementViewCount() {
    try {
      const sql = 'UPDATE teaching_modules SET view_count = view_count + 1 WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      this.view_count += 1;
    } catch (error) {
      logger.error('增加查看次数失败:', error);
    }
  }

  /**
   * 检查用户对模块的权限
   * @returns {string} 'edit' | 'view' | null
   */
  static async checkUserPermission(moduleId, userId, userRole, userGroupId, userTags = []) {
    try {
      const module = await TeachingModule.findById(moduleId);
      if (!module) {
        return null;
      }

      // 超级管理员和管理员拥有所有权限
      if (userRole === 'super_admin' || userRole === 'admin') {
        return 'edit';
      }

      // 创建者拥有编辑权限
      if (module.creator_id === userId) {
        return 'edit';
      }

      // 检查显式授权
      const tagIds = userTags.map(t => t.id);
      const tagPlaceholders = tagIds.length > 0 ? tagIds.map(() => '?').join(',') : 'NULL';

      const sql = `
        SELECT permission_type 
        FROM teaching_permissions
        WHERE module_id = ?
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (
          user_id = ? OR
          group_id = ? OR
          (tag_id IN (${tagPlaceholders}))
        )
        ORDER BY 
          CASE 
            WHEN user_id IS NOT NULL THEN 1
            WHEN group_id IS NOT NULL THEN 2
            WHEN tag_id IS NOT NULL THEN 3
          END,
          CASE permission_type
            WHEN 'edit' THEN 1
            WHEN 'view' THEN 2
          END
        LIMIT 1
      `;

      const params = [moduleId, userId, userGroupId, ...tagIds];
      const { rows } = await dbConnection.query(sql, params);

      if (rows.length > 0) {
        return rows[0].permission_type;
      }

      // 检查可见性规则
      if (module.visibility === 'public') {
        return 'view';
      }

      if (module.visibility === 'group' && module.owner_group_id === userGroupId) {
        return 'view';
      }

      return null;
    } catch (error) {
      logger.error('检查用户权限失败:', error);
      return null;
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
      cover_image: this.cover_image,
      creator_id: this.creator_id,
      creator_name: this.creator_name,
      owner_group_id: this.owner_group_id,
      owner_group_name: this.owner_group_name,
      visibility: this.visibility,
      status: this.status,
      order_index: this.order_index,
      lesson_count: this.lesson_count,
      view_count: this.view_count,
      created_at: this.created_at,
      updated_at: this.updated_at,
      published_at: this.published_at
    };
  }
}

module.exports = TeachingModule;
