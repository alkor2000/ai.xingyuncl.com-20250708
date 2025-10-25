/**
 * 系统配置模型
 * 管理站点名称、Logo等全局配置
 * 修复：添加 teaching_page_header_html 的保存支持
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
          // 根据类型解析值
          if (row.setting_type === 'json' && row.setting_value) {
            settings[row.setting_key] = JSON.parse(row.setting_value);
          } else if (row.setting_type === 'boolean') {
            settings[row.setting_key] = row.setting_value === 'true' || row.setting_value === '1';
          } else if (row.setting_type === 'number') {
            settings[row.setting_key] = Number(row.setting_value);
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
        } else if (row.setting_type === 'boolean') {
          return row.setting_value === 'true' || row.setting_value === '1';
        } else if (row.setting_type === 'number') {
          return Number(row.setting_value);
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
      
      // 根据类型转换值
      if (type === 'json' && typeof value === 'object') {
        settingValue = JSON.stringify(value);
      } else if (type === 'boolean') {
        settingValue = value ? 'true' : 'false';
      } else if (type === 'number') {
        settingValue = String(value);
      } else {
        settingValue = String(value);
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
      
      logger.info('系统配置更新成功', { key, value: settingValue, type });
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
        } else if (typeof value === 'boolean') {
          type = 'boolean';
          settingValue = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
          type = 'number';
          settingValue = String(value);
        } else {
          settingValue = String(value || '');
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
      
      // 处理html_editor.*配置 - 组合成嵌套对象
      const htmlEditorConfig = {};
      const htmlEditorKeys = [];
      
      for (const [key, value] of Object.entries(settings)) {
        if (key.startsWith('html_editor.')) {
          const subKey = key.replace('html_editor.', '');
          htmlEditorConfig[subKey] = value;
          htmlEditorKeys.push(key);
        }
      }
      
      // 从settings中移除已处理的html_editor.*键
      htmlEditorKeys.forEach(key => delete settings[key]);
      
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
          require_invitation_code: false,
          default_tokens: 10000,
          default_credits: 1000,
          default_group_id: 1
        },
        ai: settings.ai_config || {
          default_model: 'gpt-4.1-mini-op',
          temperature: 0.0
        },
        chat: settings.chat_config || {
          font_family: 'system-ui',
          font_size: 14
        },
        email: settings.email_config || null,
        login: settings.login_config || {
          mode: 'standard',
          refresh_token_days: 14
        },
        theme: settings.theme_config || null,
        html_editor: Object.keys(htmlEditorConfig).length > 0 ? htmlEditorConfig : null,
        // ✅ 新增：教学页面头部HTML配置
        teaching_page_header_html: settings.teaching_page_header_html || ''
      };

      // 处理用户配置兼容性
      if (formattedSettings.user) {
        if (formattedSettings.user.default_token_quota !== undefined && formattedSettings.user.default_tokens === undefined) {
          formattedSettings.user.default_tokens = formattedSettings.user.default_token_quota;
        }
        if (formattedSettings.user.default_credits_quota !== undefined && formattedSettings.user.default_credits === undefined) {
          formattedSettings.user.default_credits = formattedSettings.user.default_credits_quota;
        }
        
        if (settings.credits_config && settings.credits_config.default_credits !== undefined) {
          formattedSettings.user.default_credits = settings.credits_config.default_credits;
        }
        
        if (formattedSettings.user.require_invitation_code === undefined) {
          formattedSettings.user.require_invitation_code = false;
        }
        
        delete formattedSettings.user.default_token_quota;
        delete formattedSettings.user.default_credits_quota;
      }

      return formattedSettings;
    } catch (error) {
      logger.error('获取格式化配置失败:', error);
      return {
        site: {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: {
          allow_register: true,
          require_invitation_code: false,
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
        email: null,
        login: {
          mode: 'standard',
          refresh_token_days: 14
        },
        theme: null,
        html_editor: null,
        teaching_page_header_html: ''
      };
    }
  }

  /**
   * 保存格式化的系统设置
   * ✅ 修复：添加 teaching_page_header_html 的保存支持
   */
  static async saveFormattedSettings(formattedSettings) {
    try {
      // 清理用户配置
      if (formattedSettings.user) {
        const cleanedUserConfig = {
          allow_register: formattedSettings.user.allow_register !== false,
          require_invitation_code: formattedSettings.user.require_invitation_code === true,
          default_tokens: formattedSettings.user.default_tokens ?? 10000,
          default_credits: formattedSettings.user.default_credits ?? 1000,
          default_group_id: formattedSettings.user.default_group_id ?? 1
        };
        formattedSettings.user = cleanedUserConfig;
        
        logger.info('保存用户配置', cleanedUserConfig);
      }

      // 处理chat配置
      if (formattedSettings.chat) {
        const cleanedChatConfig = {
          font_family: formattedSettings.chat.font_family || 'system-ui',
          font_size: formattedSettings.chat.font_size ?? 14
        };
        formattedSettings.chat = cleanedChatConfig;
      }

      // 处理登录配置
      if (formattedSettings.login) {
        const cleanedLoginConfig = {
          mode: formattedSettings.login.mode || 'standard',
          refresh_token_days: formattedSettings.login.refresh_token_days ?? 14
        };
        formattedSettings.login = cleanedLoginConfig;
      }

      const settings = {
        site_config: formattedSettings.site,
        user_config: formattedSettings.user,
        ai_config: formattedSettings.ai,
        chat_config: formattedSettings.chat
      };
      
      // 保存邮件配置
      if (formattedSettings.email !== undefined) {
        settings.email_config = formattedSettings.email;
      }
      
      // 保存登录配置
      if (formattedSettings.login !== undefined) {
        settings.login_config = formattedSettings.login;
      }
      
      // 保存主题配置
      if (formattedSettings.theme !== undefined) {
        settings.theme_config = formattedSettings.theme;
      }
      
      // ✅ 新增：保存教学页面头部HTML配置
      if (formattedSettings.teaching_page_header_html !== undefined) {
        settings.teaching_page_header_html = formattedSettings.teaching_page_header_html;
        logger.info('保存教学页面头部HTML配置', { 
          length: formattedSettings.teaching_page_header_html?.length || 0 
        });
      }
      
      // 处理HTML编辑器配置 - 拆分成独立的配置项
      if (formattedSettings.html_editor && typeof formattedSettings.html_editor === 'object') {
        for (const [key, value] of Object.entries(formattedSettings.html_editor)) {
          const settingKey = `html_editor.${key}`;
          
          let settingType = 'string';
          if (typeof value === 'boolean') {
            settingType = 'boolean';
          } else if (typeof value === 'number') {
            settingType = 'number';
          }
          
          settings[settingKey] = value;
          await SystemConfig.updateSetting(settingKey, value, settingType);
        }
        
        delete settings['html_editor.*'];
      }
      
      // 更新其他配置
      const remainingSettings = {};
      for (const [key, value] of Object.entries(settings)) {
        if (!key.startsWith('html_editor.')) {
          remainingSettings[key] = value;
        }
      }
      
      if (Object.keys(remainingSettings).length > 0) {
        await SystemConfig.updateSettings(remainingSettings);
      }
      
      return true;
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

  /**
   * 获取登录配置
   */
  static async getLoginSettings() {
    try {
      const settings = await SystemConfig.getSetting('login_config');
      return settings || { mode: 'standard', refresh_token_days: 14 };
    } catch (error) {
      logger.error('获取登录配置失败:', error);
      return { mode: 'standard', refresh_token_days: 14 };
    }
  }

  /**
   * 更新登录配置
   */
  static async updateLoginSettings(loginConfig) {
    try {
      return await SystemConfig.updateSetting('login_config', loginConfig, 'json');
    } catch (error) {
      logger.error('更新登录配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取主题配置
   */
  static async getThemeSettings() {
    try {
      return await SystemConfig.getSetting('theme_config');
    } catch (error) {
      logger.error('获取主题配置失败:', error);
      return null;
    }
  }

  /**
   * 更新主题配置
   */
  static async updateThemeSettings(themeConfig) {
    try {
      return await SystemConfig.updateSetting('theme_config', themeConfig, 'json');
    } catch (error) {
      logger.error('更新主题配置失败:', error);
      throw error;
    }
  }
}

module.exports = SystemConfig;
