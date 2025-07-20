/**
 * 系统配置模型
 * 管理站点名称、Logo等全局配置
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class SystemConfig {
  /**
   * 获取所有系统配置
   */
  static async getAllSettings() {
    try {
      const sql = 'SELECT * FROM system_settings';
      const { rows } = await dbConnection.query(sql);
      
      // 将配置转换为键值对
      const settings = {};
      rows.forEach(row => {
        try {
          // 如果是JSON类型，解析JSON
          if (row.setting_type === 'json' && row.setting_value) {
            settings[row.setting_key] = JSON.parse(row.setting_value);
          } else {
            settings[row.setting_key] = row.setting_value;
          }
        } catch (e) {
          logger.error('解析配置失败', { key: row.setting_key, error: e.message });
          settings[row.setting_key] = row.setting_value;
        }
      });
      
      return settings;
    } catch (error) {
      logger.error('获取系统配置失败:', error);
      throw new DatabaseError('获取系统配置失败', error);
    }
  }

  /**
   * 获取单个配置
   */
  static async getSetting(key) {
    try {
      const sql = 'SELECT * FROM system_settings WHERE setting_key = ?';
      const { rows } = await dbConnection.query(sql, [key]);
      
      if (rows.length === 0) {
        return null;
      }
      
      const row = rows[0];
      try {
        if (row.setting_type === 'json' && row.setting_value) {
          return JSON.parse(row.setting_value);
        }
        return row.setting_value;
      } catch (e) {
        return row.setting_value;
      }
    } catch (error) {
      logger.error('获取配置失败:', error);
      throw new DatabaseError('获取配置失败', error);
    }
  }

  /**
   * 更新配置
   */
  static async updateSetting(key, value, type = 'string') {
    try {
      let settingValue = value;
      
      // 如果是JSON类型，序列化
      if (type === 'json' && typeof value === 'object') {
        settingValue = JSON.stringify(value);
      }
      
      // 使用UPSERT语法
      const sql = `
        INSERT INTO system_settings (setting_key, setting_value, setting_type)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
        setting_value = VALUES(setting_value),
        updated_at = CURRENT_TIMESTAMP
      `;
      
      await dbConnection.query(sql, [key, settingValue, type]);
      
      logger.info('系统配置更新成功', { key });
      return true;
    } catch (error) {
      logger.error('更新配置失败:', error);
      throw new DatabaseError('更新配置失败', error);
    }
  }

  /**
   * 批量更新配置
   */
  static async updateSettings(settings) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      for (const [key, value] of Object.entries(settings)) {
        let settingValue = value;
        let type = 'string';
        
        // 自动检测类型
        if (typeof value === 'object' && value !== null) {
          type = 'json';
          settingValue = JSON.stringify(value);
        }
        
        const sql = `
          INSERT INTO system_settings (setting_key, setting_value, setting_type)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
          setting_value = VALUES(setting_value),
          updated_at = CURRENT_TIMESTAMP
        `;
        
        await transaction.query(sql, [key, settingValue, type]);
      }
      
      await transaction.commit();
      logger.info('批量更新系统配置成功');
      return true;
    } catch (error) {
      await transaction.rollback();
      logger.error('批量更新配置失败:', error);
      throw new DatabaseError('批量更新配置失败', error);
    }
  }

  /**
   * 获取格式化的系统设置（兼容旧接口）
   */
  static async getFormattedSettings() {
    try {
      const settings = await SystemConfig.getAllSettings();
      
      // 构建兼容的格式
      return {
        site: settings.site_config || {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: settings.user_config || {
          allow_register: true,
          default_token_quota: 10000,
          default_group_id: 1,
          default_credits_quota: 1000
        },
        ai: settings.ai_config || {
          default_model: 'gpt-4.1-mini-op',
          temperature: 0.0
        },
        credits: settings.credits_config || {
          default_credits: 1000,
          max_credits: 100000,
          min_credits_for_chat: 1
        }
      };
    } catch (error) {
      logger.error('获取格式化配置失败:', error);
      // 返回默认配置
      return {
        site: {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: {
          allow_register: true,
          default_token_quota: 10000,
          default_group_id: 1,
          default_credits_quota: 1000
        },
        ai: {
          default_model: 'gpt-4.1-mini-op',
          temperature: 0.0
        },
        credits: {
          default_credits: 1000,
          max_credits: 100000,
          min_credits_for_chat: 1
        }
      };
    }
  }

  /**
   * 保存格式化的系统设置
   */
  static async saveFormattedSettings(formattedSettings) {
    try {
      const settings = {
        site_config: formattedSettings.site,
        user_config: formattedSettings.user,
        ai_config: formattedSettings.ai,
        credits_config: formattedSettings.credits
      };
      
      return await SystemConfig.updateSettings(settings);
    } catch (error) {
      logger.error('保存格式化配置失败:', error);
      throw error;
    }
  }
}

module.exports = SystemConfig;
