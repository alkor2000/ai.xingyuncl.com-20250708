/**
 * 日历分类模型
 * 支持系统预设分类和用户自定义分类
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class CalendarCategory {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  /**
   * 获取用户可用的分类（系统预设+用户自定义）
   */
  static async getUserCategories(userId) {
    try {
      const sql = `
        SELECT * FROM calendar_categories
        WHERE (user_id IS NULL OR user_id = ?) AND is_active = 1
        ORDER BY sort_order ASC, name ASC
      `;

      const { rows } = await dbConnection.query(sql, [userId]);

      return rows.map(row => new CalendarCategory(row));
    } catch (error) {
      logger.error('获取用户分类失败:', error);
      throw new DatabaseError('获取分类失败', error);
    }
  }

  /**
   * 获取系统预设分类
   */
  static async getSystemCategories() {
    try {
      const sql = `
        SELECT * FROM calendar_categories
        WHERE user_id IS NULL AND is_active = 1
        ORDER BY sort_order ASC
      `;

      const { rows } = await dbConnection.query(sql);

      return rows.map(row => new CalendarCategory(row));
    } catch (error) {
      logger.error('获取系统分类失败:', error);
      throw new DatabaseError('获取系统分类失败', error);
    }
  }

  /**
   * 创建用户自定义分类
   */
  static async create(data, userId) {
    try {
      const {
        name,
        color = '#1890ff',
        icon = 'TagOutlined',
        sort_order = 0
      } = data;

      if (!name) {
        throw new ValidationError('分类名称不能为空');
      }

      // 检查是否重名
      const checkSql = `
        SELECT id FROM calendar_categories 
        WHERE user_id = ? AND name = ?
      `;
      const { rows: existing } = await dbConnection.query(checkSql, [userId, name]);
      
      if (existing.length > 0) {
        throw new ValidationError('该分类名称已存在');
      }

      const sql = `
        INSERT INTO calendar_categories (user_id, name, color, icon, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [userId, name, color, icon, sort_order]);

      logger.info('创建自定义分类成功', { userId, categoryId: rows.insertId, name });

      return await CalendarCategory.findById(rows.insertId);
    } catch (error) {
      logger.error('创建分类失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID查找分类
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM calendar_categories WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) {
        return null;
      }

      return new CalendarCategory(rows[0]);
    } catch (error) {
      logger.error('查找分类失败:', error);
      throw new DatabaseError('查找分类失败', error);
    }
  }

  /**
   * 更新分类
   */
  static async update(id, data, userId) {
    try {
      const category = await CalendarCategory.findById(id);
      if (!category) {
        throw new ValidationError('分类不存在');
      }

      // 系统分类不能修改
      if (category.user_id === null) {
        throw new ValidationError('系统预设分类不能修改');
      }

      // 检查所有权
      if (category.user_id !== userId) {
        throw new ValidationError('无权修改此分类');
      }

      const allowedFields = ['name', 'color', 'icon', 'is_active', 'sort_order'];
      const updateFields = [];
      const updateValues = [];

      allowedFields.forEach(field => {
        if (data[field] !== undefined) {
          updateFields.push(`${field} = ?`);
          updateValues.push(data[field]);
        }
      });

      if (updateFields.length === 0) {
        return category;
      }

      updateValues.push(id);
      const sql = `UPDATE calendar_categories SET ${updateFields.join(', ')} WHERE id = ?`;
      await dbConnection.query(sql, updateValues);

      logger.info('更新分类成功', { userId, categoryId: id });

      return await CalendarCategory.findById(id);
    } catch (error) {
      logger.error('更新分类失败:', error);
      throw error;
    }
  }

  /**
   * 删除分类
   */
  static async delete(id, userId) {
    try {
      const category = await CalendarCategory.findById(id);
      if (!category) {
        throw new ValidationError('分类不存在');
      }

      // 系统分类不能删除
      if (category.user_id === null) {
        throw new ValidationError('系统预设分类不能删除');
      }

      // 检查所有权
      if (category.user_id !== userId) {
        throw new ValidationError('无权删除此分类');
      }

      // 检查是否有事项使用此分类
      const checkSql = 'SELECT COUNT(*) as count FROM calendar_events WHERE user_id = ? AND category = ?';
      const { rows } = await dbConnection.query(checkSql, [userId, category.name]);

      if (rows[0].count > 0) {
        throw new ValidationError('该分类下还有事项，无法删除');
      }

      const sql = 'DELETE FROM calendar_categories WHERE id = ?';
      await dbConnection.query(sql, [id]);

      logger.info('删除分类成功', { userId, categoryId: id });

      return true;
    } catch (error) {
      logger.error('删除分类失败:', error);
      throw error;
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      name: this.name,
      color: this.color,
      icon: this.icon,
      is_active: this.is_active,
      sort_order: this.sort_order,
      is_system: this.user_id === null,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = CalendarCategory;
