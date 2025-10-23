/**
 * 教学权限模型
 * 管理教学模块的权限授予、撤销和查询
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class TeachingPermission {
  constructor(data = {}) {
    this.id = data.id || null;
    this.module_id = data.module_id || null;
    this.user_id = data.user_id || null;
    this.group_id = data.group_id || null;
    this.tag_id = data.tag_id || null;
    this.permission_type = data.permission_type || 'view';
    this.granted_by = data.granted_by || null;
    this.granted_at = data.granted_at || null;
    this.expires_at = data.expires_at || null;
    this.note = data.note || null;
  }

  /**
   * 授予权限（支持用户/组织/标签三种方式）
   */
  static async grant(permissionData) {
    try {
      const {
        module_id,
        user_id = null,
        group_id = null,
        tag_id = null,
        permission_type = 'view',
        granted_by,
        expires_at = null,
        note = null
      } = permissionData;

      // 验证必填项
      if (!module_id || !granted_by) {
        throw new ValidationError('模块ID和授权人为必填项');
      }

      // 验证授权对象（三选一）
      const targetCount = [user_id, group_id, tag_id].filter(x => x !== null).length;
      if (targetCount !== 1) {
        throw new ValidationError('必须且只能指定一个授权对象（用户/组织/标签）');
      }

      // 检查是否已存在相同授权
      const existsSql = `
        SELECT id FROM teaching_permissions
        WHERE module_id = ?
        AND permission_type = ?
        AND (
          (user_id = ? AND user_id IS NOT NULL) OR
          (group_id = ? AND group_id IS NOT NULL) OR
          (tag_id = ? AND tag_id IS NOT NULL)
        )
      `;

      const { rows: existingRows } = await dbConnection.query(existsSql, [
        module_id, permission_type,
        user_id, group_id, tag_id
      ]);

      if (existingRows.length > 0) {
        throw new ValidationError('该授权已存在');
      }

      // 插入新授权
      const sql = `
        INSERT INTO teaching_permissions (
          module_id, user_id, group_id, tag_id, permission_type,
          granted_by, granted_at, expires_at, note
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)
      `;

      const params = [
        module_id, user_id, group_id, tag_id, permission_type,
        granted_by, expires_at, note
      ];

      const { rows } = await dbConnection.query(sql, params);
      const permissionId = rows.insertId;

      logger.info('权限授予成功', {
        permissionId,
        module_id,
        user_id,
        group_id,
        tag_id,
        permission_type,
        granted_by
      });

      return await TeachingPermission.findById(permissionId);
    } catch (error) {
      logger.error('授予权限失败:', error);
      throw new DatabaseError('授予权限失败', error);
    }
  }

  /**
   * 根据ID查找权限
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT tp.*,
               u.username as target_user_name,
               ug.name as target_group_name,
               ut.name as target_tag_name,
               granter.username as granted_by_name
        FROM teaching_permissions tp
        LEFT JOIN users u ON tp.user_id = u.id
        LEFT JOIN user_groups ug ON tp.group_id = ug.id
        LEFT JOIN user_tags ut ON tp.tag_id = ut.id
        LEFT JOIN users granter ON tp.granted_by = granter.id
        WHERE tp.id = ?
      `;

      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) {
        return null;
      }

      return new TeachingPermission(rows[0]);
    } catch (error) {
      logger.error('查找权限失败:', error);
      throw new DatabaseError('查找权限失败', error);
    }
  }

  /**
   * 获取模块的所有权限列表
   */
  static async getModulePermissions(moduleId) {
    try {
      const sql = `
        SELECT tp.*,
               u.username as target_user_name,
               u.email as target_user_email,
               ug.name as target_group_name,
               ut.name as target_tag_name,
               ut.color as target_tag_color,
               granter.username as granted_by_name
        FROM teaching_permissions tp
        LEFT JOIN users u ON tp.user_id = u.id
        LEFT JOIN user_groups ug ON tp.group_id = ug.id
        LEFT JOIN user_tags ut ON tp.tag_id = ut.id
        LEFT JOIN users granter ON tp.granted_by = granter.id
        WHERE tp.module_id = ?
        ORDER BY 
          tp.permission_type DESC,
          CASE 
            WHEN tp.user_id IS NOT NULL THEN 1
            WHEN tp.group_id IS NOT NULL THEN 2
            WHEN tp.tag_id IS NOT NULL THEN 3
          END,
          tp.granted_at DESC
      `;

      const { rows } = await dbConnection.query(sql, [moduleId]);

      return rows.map(row => new TeachingPermission(row));
    } catch (error) {
      logger.error('获取模块权限列表失败:', error);
      throw new DatabaseError('获取权限列表失败', error);
    }
  }

  /**
   * 撤销权限
   */
  static async revoke(permissionId) {
    try {
      const sql = 'DELETE FROM teaching_permissions WHERE id = ?';
      await dbConnection.query(sql, [permissionId]);

      logger.info('权限撤销成功', { permissionId });

      return true;
    } catch (error) {
      logger.error('撤销权限失败:', error);
      throw new DatabaseError('撤销权限失败', error);
    }
  }

  /**
   * 批量撤销权限
   */
  static async revokeMultiple(permissionIds) {
    try {
      if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
        throw new ValidationError('权限ID列表不能为空');
      }

      const placeholders = permissionIds.map(() => '?').join(',');
      const sql = `DELETE FROM teaching_permissions WHERE id IN (${placeholders})`;

      await dbConnection.query(sql, permissionIds);

      logger.info('批量撤销权限成功', { count: permissionIds.length });

      return true;
    } catch (error) {
      logger.error('批量撤销权限失败:', error);
      throw new DatabaseError('批量撤销权限失败', error);
    }
  }

  /**
   * 清理过期权限
   */
  static async cleanupExpired() {
    try {
      const sql = `
        DELETE FROM teaching_permissions 
        WHERE expires_at IS NOT NULL 
        AND expires_at < NOW()
      `;

      const { rows } = await dbConnection.query(sql);
      const affectedRows = rows.affectedRows || 0;

      if (affectedRows > 0) {
        logger.info('清理过期权限成功', { count: affectedRows });
      }

      return affectedRows;
    } catch (error) {
      logger.error('清理过期权限失败:', error);
      throw new DatabaseError('清理过期权限失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      module_id: this.module_id,
      user_id: this.user_id,
      group_id: this.group_id,
      tag_id: this.tag_id,
      target_user_name: this.target_user_name,
      target_user_email: this.target_user_email,
      target_group_name: this.target_group_name,
      target_tag_name: this.target_tag_name,
      target_tag_color: this.target_tag_color,
      permission_type: this.permission_type,
      granted_by: this.granted_by,
      granted_by_name: this.granted_by_name,
      granted_at: this.granted_at,
      expires_at: this.expires_at,
      note: this.note
    };
  }
}

module.exports = TeachingPermission;
