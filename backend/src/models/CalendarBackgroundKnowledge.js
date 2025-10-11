/**
 * 日历背景知识Model
 * 管理用户的个人背景信息，用于AI分析时提供上下文
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class CalendarBackgroundKnowledge {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_uuid = data.user_uuid || null;
    this.title = data.title || null;
    this.content = data.content || null;
    this.enabled = data.enabled !== undefined ? data.enabled : true;
    this.sort_order = data.sort_order !== undefined ? data.sort_order : 0;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 验证数据
   */
  static validate(data) {
    const errors = {};

    // 验证标题
    if (!data.title || data.title.trim() === '') {
      errors.title = '标题不能为空';
    } else if (data.title.length > 100) {
      errors.title = '标题长度不能超过100字符';
    }

    // 验证内容
    if (!data.content || data.content.trim() === '') {
      errors.content = '内容不能为空';
    } else if (data.content.length > 2000) {
      errors.content = '内容长度不能超过2000字符';
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError('数据验证失败', errors);
    }

    return true;
  }

  /**
   * 根据ID查找背景知识
   */
  static async findById(id, userUuid) {
    try {
      const sql = `
        SELECT * FROM calendar_background_knowledge 
        WHERE id = ? AND user_uuid = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [id, userUuid]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new CalendarBackgroundKnowledge(rows[0]);
    } catch (error) {
      logger.error('根据ID查找背景知识失败:', error);
      throw new DatabaseError('查找背景知识失败', error);
    }
  }

  /**
   * 获取用户的所有背景知识
   */
  static async getUserKnowledge(userUuid, options = {}) {
    try {
      const { enabled_only = false } = options;

      let sql = `
        SELECT * FROM calendar_background_knowledge 
        WHERE user_uuid = ?
      `;
      
      const params = [userUuid];

      if (enabled_only) {
        sql += ' AND enabled = TRUE';
      }

      sql += ' ORDER BY sort_order ASC, created_at ASC';

      const { rows } = await dbConnection.query(sql, params);

      return rows.map(row => new CalendarBackgroundKnowledge(row));
    } catch (error) {
      logger.error('获取用户背景知识失败:', error);
      throw new DatabaseError('获取背景知识列表失败', error);
    }
  }

  /**
   * 获取用户已启用的背景知识（用于AI分析）
   */
  static async getEnabledKnowledge(userUuid) {
    return await CalendarBackgroundKnowledge.getUserKnowledge(userUuid, {
      enabled_only: true
    });
  }

  /**
   * 创建背景知识
   */
  static async create(data, userUuid) {
    try {
      // 验证数据
      CalendarBackgroundKnowledge.validate(data);

      const {
        title,
        content,
        enabled = true,
        sort_order = 0
      } = data;

      const sql = `
        INSERT INTO calendar_background_knowledge 
        (user_uuid, title, content, enabled, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        userUuid,
        title.trim(),
        content.trim(),
        enabled,
        sort_order
      ]);

      const knowledgeId = rows.insertId;

      logger.info('背景知识创建成功', {
        id: knowledgeId,
        userUuid,
        title
      });

      return await CalendarBackgroundKnowledge.findById(knowledgeId, userUuid);
    } catch (error) {
      logger.error('创建背景知识失败:', error);
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('创建背景知识失败', error);
    }
  }

  /**
   * 更新背景知识
   */
  static async update(id, data, userUuid) {
    try {
      // 检查所有权
      const existing = await CalendarBackgroundKnowledge.findById(id, userUuid);
      if (!existing) {
        throw new ValidationError('背景知识不存在或无权修改');
      }

      // 验证数据（只验证提供的字段）
      const validateData = {};
      if (data.title !== undefined) validateData.title = data.title;
      if (data.content !== undefined) validateData.content = data.content;
      
      if (Object.keys(validateData).length > 0) {
        CalendarBackgroundKnowledge.validate({
          title: validateData.title || existing.title,
          content: validateData.content || existing.content
        });
      }

      // 构建更新字段
      const allowedFields = ['title', 'content', 'enabled', 'sort_order'];
      const updateFields = Object.keys(data).filter(field => allowedFields.includes(field));

      if (updateFields.length === 0) {
        return existing;
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => {
        const value = data[field];
        // Trim字符串字段
        if (field === 'title' || field === 'content') {
          return typeof value === 'string' ? value.trim() : value;
        }
        return value;
      });
      values.push(id, userUuid);

      const sql = `
        UPDATE calendar_background_knowledge 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND user_uuid = ?
      `;

      await dbConnection.query(sql, values);

      logger.info('背景知识更新成功', {
        id,
        userUuid,
        updatedFields: updateFields
      });

      return await CalendarBackgroundKnowledge.findById(id, userUuid);
    } catch (error) {
      logger.error('更新背景知识失败:', error);
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('更新背景知识失败', error);
    }
  }

  /**
   * 删除背景知识
   */
  static async delete(id, userUuid) {
    try {
      // 检查所有权
      const existing = await CalendarBackgroundKnowledge.findById(id, userUuid);
      if (!existing) {
        throw new ValidationError('背景知识不存在或无权删除');
      }

      const sql = `
        DELETE FROM calendar_background_knowledge 
        WHERE id = ? AND user_uuid = ?
      `;

      await dbConnection.query(sql, [id, userUuid]);

      logger.info('背景知识删除成功', {
        id,
        userUuid,
        title: existing.title
      });

      return true;
    } catch (error) {
      logger.error('删除背景知识失败:', error);
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('删除背景知识失败', error);
    }
  }

  /**
   * 批量更新排序
   */
  static async reorder(items, userUuid) {
    try {
      // items: [{ id, sort_order }, ...]
      if (!Array.isArray(items) || items.length === 0) {
        throw new ValidationError('排序数据不能为空');
      }

      await dbConnection.transaction(async (query) => {
        for (const item of items) {
          const { id, sort_order } = item;
          
          // 验证所有权
          const existing = await CalendarBackgroundKnowledge.findById(id, userUuid);
          if (!existing) {
            throw new ValidationError(`背景知识 ID ${id} 不存在或无权修改`);
          }

          const sql = `
            UPDATE calendar_background_knowledge 
            SET sort_order = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND user_uuid = ?
          `;

          await query(sql, [sort_order, id, userUuid]);
        }
      });

      logger.info('背景知识排序更新成功', {
        userUuid,
        count: items.length
      });

      return await CalendarBackgroundKnowledge.getUserKnowledge(userUuid);
    } catch (error) {
      logger.error('更新背景知识排序失败:', error);
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('更新排序失败', error);
    }
  }

  /**
   * 切换启用状态
   */
  async toggleEnabled() {
    try {
      const newEnabled = !this.enabled;
      
      const sql = `
        UPDATE calendar_background_knowledge 
        SET enabled = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND user_uuid = ?
      `;

      await dbConnection.query(sql, [newEnabled, this.id, this.user_uuid]);

      this.enabled = newEnabled;

      logger.info('背景知识状态切换成功', {
        id: this.id,
        enabled: newEnabled
      });

      return this;
    } catch (error) {
      logger.error('切换背景知识状态失败:', error);
      throw new DatabaseError('切换状态失败', error);
    }
  }

  /**
   * 获取用户统计
   */
  static async getUserStats(userUuid) {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN enabled = TRUE THEN 1 ELSE 0 END) as enabled_count,
          SUM(CASE WHEN enabled = FALSE THEN 1 ELSE 0 END) as disabled_count
        FROM calendar_background_knowledge
        WHERE user_uuid = ?
      `;

      const { rows } = await dbConnection.query(sql, [userUuid]);

      return {
        total: rows[0].total || 0,
        enabled: rows[0].enabled_count || 0,
        disabled: rows[0].disabled_count || 0
      };
    } catch (error) {
      logger.error('获取用户背景知识统计失败:', error);
      throw new DatabaseError('获取统计失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_uuid: this.user_uuid,
      title: this.title,
      content: this.content,
      enabled: this.enabled,
      sort_order: this.sort_order,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = CalendarBackgroundKnowledge;
