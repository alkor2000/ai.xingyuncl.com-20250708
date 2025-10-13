/**
 * 日历事项模型
 * 支持CRUD操作、重复事项、状态管理
 * 优化：title必填，content可选
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class CalendarEvent {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  /**
   * 根据ID查找事项
   */
  static async findById(id, userId = null) {
    try {
      let sql = `
        SELECT ce.*, 
               cc.name as category_name,
               cc.color as category_color,
               u.username as creator_name
        FROM calendar_events ce
        LEFT JOIN calendar_categories cc ON ce.category = cc.name AND (cc.user_id = ce.user_id OR cc.user_id IS NULL)
        LEFT JOIN users u ON ce.user_id = u.id
        WHERE ce.id = ?
      `;
      
      const params = [id];
      
      if (userId !== null) {
        sql += ' AND ce.user_id = ?';
        params.push(userId);
      }
      
      const { rows } = await dbConnection.query(sql, params);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new CalendarEvent(rows[0]);
    } catch (error) {
      logger.error('根据ID查找日历事项失败:', error);
      throw new DatabaseError('查找日历事项失败', error);
    }
  }

  /**
   * 获取用户在指定日期范围内的事项列表
   */
  static async getUserEvents(userId, options = {}) {
    try {
      const {
        start_date,
        end_date,
        status,
        category,
        importance_min,
        importance_max,
        page = 1,
        limit = 100
      } = options;

      let whereConditions = ['ce.user_id = ?'];
      let params = [userId];

      if (start_date) {
        whereConditions.push('ce.event_date >= ?');
        params.push(start_date);
      }
      if (end_date) {
        whereConditions.push('ce.event_date <= ?');
        params.push(end_date);
      }

      if (status) {
        whereConditions.push('ce.status = ?');
        params.push(status);
      }

      if (category) {
        whereConditions.push('ce.category = ?');
        params.push(category);
      }

      if (importance_min !== undefined) {
        whereConditions.push('ce.importance >= ?');
        params.push(importance_min);
      }
      if (importance_max !== undefined) {
        whereConditions.push('ce.importance <= ?');
        params.push(importance_max);
      }

      const whereClause = whereConditions.join(' AND ');

      const countSql = `
        SELECT COUNT(*) as total 
        FROM calendar_events ce 
        WHERE ${whereClause}
      `;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      const offset = (page - 1) * limit;
      const listSql = `
        SELECT ce.*, 
               cc.name as category_name,
               cc.color as category_color
        FROM calendar_events ce
        LEFT JOIN calendar_categories cc ON ce.category = cc.name AND (cc.user_id = ce.user_id OR cc.user_id IS NULL)
        WHERE ${whereClause}
        ORDER BY ce.event_date ASC, ce.sort_order ASC, ce.importance DESC, ce.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows: events } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);

      return {
        events: events.map(event => new CalendarEvent(event)),
        pagination: {
          page,
          limit,
          total
        }
      };
    } catch (error) {
      logger.error('获取用户日历事项失败:', error);
      throw new DatabaseError('获取日历事项失败', error);
    }
  }

  /**
   * 获取用户在指定日期的事项统计（月视图用）
   * 修复：使用反引号避免MySQL保留字冲突
   */
  static async getMonthStats(userId, year, month) {
    try {
      const sql = `
        SELECT 
          DATE(event_date) as date,
          COUNT(*) as \`count\`,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
          COUNT(CASE WHEN importance >= 8 THEN 1 END) as high_priority_count,
          MAX(importance) as max_importance,
          GROUP_CONCAT(DISTINCT category) as categories
        FROM calendar_events
        WHERE user_id = ?
          AND YEAR(event_date) = ?
          AND MONTH(event_date) = ?
        GROUP BY DATE(event_date)
        ORDER BY date ASC
      `;

      const { rows } = await dbConnection.query(sql, [userId, year, month]);
      
      return rows.map(row => ({
        date: row.date,
        count: row.count,
        completed_count: row.completed_count,
        high_priority: row.high_priority_count,
        max_importance: row.max_importance,
        categories: row.categories ? row.categories.split(',') : []
      }));
    } catch (error) {
      logger.error('获取月度统计失败:', error);
      throw new DatabaseError('获取月度统计失败', error);
    }
  }

  /**
   * 创建事项（🔥 title必填，content可选）
   */
  static async create(data, userId) {
    try {
      const {
        title,
        event_date,
        content = null,
        importance = 5,
        category = '其他',
        color = '#1890ff',
        status = 'not_started',
        file_link = null,
        recurrence_type = 'none',
        recurrence_end_date = null,
        sort_order = 0
      } = data;

      // 🔥 title必填，content可选
      if (!event_date || !title) {
        throw new ValidationError('事项日期和标题为必填项');
      }

      if (importance < 0 || importance > 10) {
        throw new ValidationError('重要度必须在0-10之间');
      }

      // 验证title长度
      if (title.length > 100) {
        throw new ValidationError('事项标题不能超过100个字符');
      }

      const sql = `
        INSERT INTO calendar_events (
          user_id, title, event_date, content, importance, category, color,
          status, file_link, recurrence_type, recurrence_end_date, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        userId, title, event_date, content, importance, category, color,
        status, file_link, recurrence_type, recurrence_end_date, sort_order
      ]);

      const eventId = rows.insertId;

      logger.info('日历事项创建成功', {
        userId,
        eventId,
        title,
        event_date,
        category
      });

      return await CalendarEvent.findById(eventId);
    } catch (error) {
      logger.error('创建日历事项失败:', error);
      throw new DatabaseError('创建日历事项失败', error);
    }
  }

  /**
   * 更新事项（🔥 title必填，content可选）
   */
  static async update(id, data, userId) {
    try {
      const event = await CalendarEvent.findById(id, userId);
      if (!event) {
        throw new ValidationError('事项不存在或无权修改');
      }

      const allowedFields = [
        'title', 'event_date', 'content', 'importance', 'category', 'color',
        'status', 'file_link', 'recurrence_type', 'recurrence_end_date', 'sort_order'
      ];

      const updateFields = [];
      const updateValues = [];

      allowedFields.forEach(field => {
        if (data[field] !== undefined) {
          updateFields.push(`${field} = ?`);
          updateValues.push(data[field]);
        }
      });

      if (updateFields.length === 0) {
        return event;
      }

      if (data.importance !== undefined && (data.importance < 0 || data.importance > 10)) {
        throw new ValidationError('重要度必须在0-10之间');
      }

      if (data.title !== undefined) {
        if (!data.title || data.title.trim() === '') {
          throw new ValidationError('事项标题不能为空');
        }
        if (data.title.length > 100) {
          throw new ValidationError('事项标题不能超过100个字符');
        }
      }

      updateValues.push(id);
      const sql = `UPDATE calendar_events SET ${updateFields.join(', ')} WHERE id = ?`;
      await dbConnection.query(sql, updateValues);

      logger.info('日历事项更新成功', { userId, eventId: id });

      return await CalendarEvent.findById(id);
    } catch (error) {
      logger.error('更新日历事项失败:', error);
      throw error;
    }
  }

  /**
   * 删除事项
   */
  static async delete(id, userId) {
    try {
      const event = await CalendarEvent.findById(id, userId);
      if (!event) {
        throw new ValidationError('事项不存在或无权删除');
      }

      const sql = 'DELETE FROM calendar_events WHERE id = ?';
      await dbConnection.query(sql, [id]);

      logger.info('日历事项删除成功', { userId, eventId: id });

      return true;
    } catch (error) {
      logger.error('删除日历事项失败:', error);
      throw new DatabaseError('删除日历事项失败', error);
    }
  }

  /**
   * 批量删除事项
   */
  static async batchDelete(ids, userId) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new ValidationError('请选择要删除的事项');
      }

      const placeholders = ids.map(() => '?').join(',');
      const sql = `DELETE FROM calendar_events WHERE id IN (${placeholders}) AND user_id = ?`;
      
      const { rows } = await dbConnection.query(sql, [...ids, userId]);
      const deletedCount = rows.affectedRows;

      logger.info('批量删除日历事项成功', { userId, count: deletedCount });

      return deletedCount;
    } catch (error) {
      logger.error('批量删除日历事项失败:', error);
      throw new DatabaseError('批量删除失败', error);
    }
  }

  /**
   * 快速标记完成
   */
  static async markComplete(id, userId) {
    try {
      const event = await CalendarEvent.findById(id, userId);
      if (!event) {
        throw new ValidationError('事项不存在或无权修改');
      }

      const sql = 'UPDATE calendar_events SET status = ? WHERE id = ?';
      await dbConnection.query(sql, ['completed', id]);

      logger.info('事项标记完成', { userId, eventId: id });

      return await CalendarEvent.findById(id);
    } catch (error) {
      logger.error('标记完成失败:', error);
      throw new DatabaseError('标记完成失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      title: this.title,
      event_date: this.event_date,
      content: this.content,
      importance: this.importance,
      category: this.category,
      color: this.color,
      status: this.status,
      file_link: this.file_link,
      recurrence_type: this.recurrence_type,
      recurrence_end_date: this.recurrence_end_date,
      parent_event_id: this.parent_event_id,
      sort_order: this.sort_order,
      created_at: this.created_at,
      updated_at: this.updated_at,
      category_name: this.category_name,
      category_color: this.category_color,
      creator_name: this.creator_name
    };
  }
}

module.exports = CalendarEvent;
