/**
 * 日历用户设置模型
 * 管理用户的个性化设置
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class CalendarUserSettings {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  /**
   * 获取用户设置（如果不存在则创建默认设置）
   */
  static async getOrCreate(userId) {
    try {
      let sql = `
        SELECT cus.*, 
               am.display_name as default_model_name
        FROM calendar_user_settings cus
        LEFT JOIN ai_models am ON cus.default_model_id = am.id
        WHERE cus.user_id = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [userId]);
      
      if (rows.length > 0) {
        return new CalendarUserSettings(rows[0]);
      }

      // 不存在则创建默认设置
      const insertSql = `
        INSERT INTO calendar_user_settings (
          user_id, auto_analysis_enabled, auto_analysis_frequency, default_scan_range
        ) VALUES (?, 0, 'weekly', 15)
      `;
      
      await dbConnection.query(insertSql, [userId]);
      
      logger.info('创建用户默认日历设置', { userId });
      
      return await CalendarUserSettings.getOrCreate(userId);
    } catch (error) {
      logger.error('获取用户设置失败:', error);
      throw new DatabaseError('获取用户设置失败', error);
    }
  }

  /**
   * 更新用户设置
   */
  static async update(userId, data) {
    try {
      // 确保设置存在
      await CalendarUserSettings.getOrCreate(userId);

      const allowedFields = [
        'auto_analysis_enabled',
        'auto_analysis_frequency',
        'default_scan_range',
        'default_model_id'
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
        return await CalendarUserSettings.getOrCreate(userId);
      }

      // 验证扫描范围
      if (data.default_scan_range !== undefined) {
        if (data.default_scan_range < 1 || data.default_scan_range > 365) {
          throw new ValidationError('扫描范围必须在1-365天之间');
        }
      }

      // 验证自动分析频率
      if (data.auto_analysis_frequency !== undefined) {
        const validFrequencies = ['daily', 'weekly', 'monthly'];
        if (!validFrequencies.includes(data.auto_analysis_frequency)) {
          throw new ValidationError('无效的分析频率');
        }
      }

      updateValues.push(userId);
      const sql = `UPDATE calendar_user_settings SET ${updateFields.join(', ')} WHERE user_id = ?`;
      await dbConnection.query(sql, updateValues);

      logger.info('用户日历设置更新成功', { userId, updatedFields: updateFields });

      return await CalendarUserSettings.getOrCreate(userId);
    } catch (error) {
      logger.error('更新用户设置失败:', error);
      throw error;
    }
  }

  /**
   * 重置为默认设置
   */
  static async reset(userId) {
    try {
      const sql = `
        UPDATE calendar_user_settings 
        SET auto_analysis_enabled = 0,
            auto_analysis_frequency = 'weekly',
            default_scan_range = 15,
            default_model_id = NULL
        WHERE user_id = ?
      `;

      await dbConnection.query(sql, [userId]);

      logger.info('用户日历设置已重置', { userId });

      return await CalendarUserSettings.getOrCreate(userId);
    } catch (error) {
      logger.error('重置用户设置失败:', error);
      throw new DatabaseError('重置设置失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      auto_analysis_enabled: this.auto_analysis_enabled === 1,
      auto_analysis_frequency: this.auto_analysis_frequency,
      default_scan_range: this.default_scan_range,
      default_model_id: this.default_model_id,
      default_model_name: this.default_model_name,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = CalendarUserSettings;
