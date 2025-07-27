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
      
      // 构建配置格式，处理兼容性
      const formattedSettings = {
        site: settings.site_config || {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: settings.user_config || {
          allow_register: true,
          default_tokens: 10000,
          default_credits: 1000,
          default_group_id: 1
        },
        ai: settings.ai_config || {
          default_model: 'gpt-4.1-mini-op',
          temperature: 0.0
        },
        // 添加chat配置
        chat: settings.chat_config || {
          font_family: 'system-ui',
          font_size: 14
        },
        // 添加邮件配置
        email: settings.email_config || null
      };

      // 处理用户配置兼容性
      if (formattedSettings.user) {
        // 兼容旧字段名 default_token_quota -> default_tokens
        if (formattedSettings.user.default_token_quota !== undefined && formattedSettings.user.default_tokens === undefined) {
          formattedSettings.user.default_tokens = formattedSettings.user.default_token_quota;
        }
        // 兼容旧字段名 default_credits_quota -> default_credits
        if (formattedSettings.user.default_credits_quota !== undefined && formattedSettings.user.default_credits === undefined) {
          formattedSettings.user.default_credits = formattedSettings.user.default_credits_quota;
        }
        
        // 如果旧的credits配置中有default_credits，优先使用
        if (settings.credits_config && settings.credits_config.default_credits !== undefined) {
          formattedSettings.user.default_credits = settings.credits_config.default_credits;
        }
        
        // 清理旧字段
        delete formattedSettings.user.default_token_quota;
        delete formattedSettings.user.default_credits_quota;
      }

      return formattedSettings;
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
          default_tokens: 10000,
          default_credits: 1000,
          default_group_id: 1
        },
        ai: {
          default_model: 'gpt-4.1-mini-op',
          temperature: 0.0
        },
        chat: {
          font_family: 'system-ui',
          font_size: 14
        },
        email: null
      };
    }
  }

  /**
   * 保存格式化的系统设置
   */
  static async saveFormattedSettings(formattedSettings) {
    try {
      // 清理用户配置中的旧字段，使用更准确的默认值处理
      if (formattedSettings.user) {
        const cleanedUserConfig = {
          allow_register: formattedSettings.user.allow_register !== false,
          // 使用 ?? 操作符，这样 0 也会被当作有效值
          default_tokens: formattedSettings.user.default_tokens ?? 10000,
          default_credits: formattedSettings.user.default_credits ?? 1000,
          default_group_id: formattedSettings.user.default_group_id ?? 1
        };
        formattedSettings.user = cleanedUserConfig;
      }

      // 处理chat配置
      if (formattedSettings.chat) {
        const cleanedChatConfig = {
          font_family: formattedSettings.chat.font_family || 'system-ui',
          font_size: formattedSettings.chat.font_size ?? 14
        };
        formattedSettings.chat = cleanedChatConfig;
      }

      const settings = {
        site_config: formattedSettings.site,
        user_config: formattedSettings.user,
        ai_config: formattedSettings.ai,
        chat_config: formattedSettings.chat
      };
      
      // 保存邮件配置（如果存在）
      if (formattedSettings.email !== undefined) {
        settings.email_config = formattedSettings.email;
      }
      
      return await SystemConfig.updateSettings(settings);
    } catch (error) {
      logger.error('保存格式化配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取邮件配置
   */
  static async getEmailSettings() {
    try {
      return await SystemConfig.getSetting('email_config');
    } catch (error) {
      logger.error('获取邮件配置失败:', error);
      return null;
    }
  }

  /**
   * 更新邮件配置
   */
  static async updateEmailSettings(emailConfig) {
    try {
      return await SystemConfig.updateSetting('email_config', emailConfig, 'json');
    } catch (error) {
      logger.error('更新邮件配置失败:', error);
      throw error;
    }
  }
}

module.exports = SystemConfig;
