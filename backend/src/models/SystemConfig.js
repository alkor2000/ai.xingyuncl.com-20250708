/**
 * 系统配置模型
 * 
 * 职责：
 * 1. 管理 system_settings 表的键值对配置
 * 2. 类型自动转换（json/boolean/number/string）
 * 3. 格式化配置输出（兼容旧接口字段名）
 * 4. 批量更新配置（事务保护）
 * 
 * 表结构：system_settings (setting_key UK, setting_value TEXT, setting_type VARCHAR)
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * 默认系统配置
 * 集中定义，避免在多处重复硬编码
 */
const DEFAULT_SETTINGS = {
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

class SystemConfig {
  /**
   * 获取所有系统配置
   * 
   * @returns {Object} 键值对形式的配置，值已按 setting_type 自动转换类型
   */
  static async getAllSettings() {
    try {
      const sql = 'SELECT * FROM system_settings';
      const { rows } = await dbConnection.query(sql);

      const settings = {};
      rows.forEach(row => {
        try {
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
   * 
   * @param {string} key - 配置键名
   * @returns {*} 类型转换后的配置值，不存在返回 null
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
   * 更新单个配置（UPSERT）
   * 
   * @param {string} key - 配置键名
   * @param {*} value - 配置值
   * @param {string} type - 值类型：string/json/boolean/number
   * @returns {boolean} true 表示更新成功
   */
  static async updateSetting(key, value, type = 'string') {
    try {
      let settingValue = value;

      if (type === 'json' && typeof value === 'object') {
        settingValue = JSON.stringify(value);
      } else if (type === 'boolean') {
        settingValue = value ? 'true' : 'false';
      } else if (type === 'number') {
        settingValue = String(value);
      } else {
        settingValue = String(value);
      }

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
   * 批量更新配置（事务保护）
   * 
   * 使用 dbConnection.transaction() 自动管理事务生命周期，
   * 避免手动 beginTransaction 可能导致的连接泄漏
   * 
   * @param {Object} settings - 键值对形式的配置
   * @returns {boolean} true 表示全部更新成功
   */
  static async updateSettings(settings) {
    try {
      await dbConnection.transaction(async (query) => {
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

          await query(sql, [key, settingValue, type]);
        }
      });

      logger.info('批量更新系统配置成功');
      return true;
    } catch (error) {
      logger.error('批量更新配置失败:', error);
      throw new DatabaseError('批量更新配置失败', error);
    }
  }

  /**
   * 获取格式化的系统设置（兼容旧接口）
   * 
   * 处理逻辑：
   * 1. 从数据库读取所有配置
   * 2. 将 html_editor.* 平铺键组合成嵌套对象
   * 3. 处理用户配置字段名兼容（旧字段 default_token_quota → default_tokens）
   * 4. user_config 中的值优先于旧的 credits_config
   * 
   * @returns {Object} 格式化后的配置对象
   */
  static async getFormattedSettings() {
    try {
      const settings = await SystemConfig.getAllSettings();

      // 处理 html_editor.* 配置 - 组合成嵌套对象
      const htmlEditorConfig = {};
      const htmlEditorKeys = [];

      for (const [key, value] of Object.entries(settings)) {
        if (key.startsWith('html_editor.')) {
          const subKey = key.replace('html_editor.', '');
          htmlEditorConfig[subKey] = value;
          htmlEditorKeys.push(key);
        }
      }

      // 从 settings 中移除已处理的 html_editor.* 键
      htmlEditorKeys.forEach(key => delete settings[key]);

      // 构建格式化配置
      const formattedSettings = {
        site: settings.site_config || { ...DEFAULT_SETTINGS.site },
        user: settings.user_config || { ...DEFAULT_SETTINGS.user },
        ai: settings.ai_config || { ...DEFAULT_SETTINGS.ai },
        chat: settings.chat_config || { ...DEFAULT_SETTINGS.chat },
        email: settings.email_config || DEFAULT_SETTINGS.email,
        login: settings.login_config || { ...DEFAULT_SETTINGS.login },
        theme: settings.theme_config || DEFAULT_SETTINGS.theme,
        html_editor: Object.keys(htmlEditorConfig).length > 0 ? htmlEditorConfig : DEFAULT_SETTINGS.html_editor,
        teaching_page_header_html: settings.teaching_page_header_html || DEFAULT_SETTINGS.teaching_page_header_html
      };

      // 处理用户配置兼容性 - user_config 优先级最高
      if (formattedSettings.user) {
        // 旧字段名兼容：default_token_quota → default_tokens
        if (formattedSettings.user.default_tokens === undefined &&
            formattedSettings.user.default_token_quota !== undefined) {
          formattedSettings.user.default_tokens = formattedSettings.user.default_token_quota;
        }

        // 旧字段名兼容：default_credits_quota → default_credits
        if (formattedSettings.user.default_credits === undefined &&
            formattedSettings.user.default_credits_quota !== undefined) {
          formattedSettings.user.default_credits = formattedSettings.user.default_credits_quota;
        }

        // 从旧的 credits_config 读取（最低优先级向后兼容）
        if (formattedSettings.user.default_credits === undefined &&
            settings.credits_config &&
            settings.credits_config.default_credits !== undefined) {
          formattedSettings.user.default_credits = settings.credits_config.default_credits;
          logger.info('从旧 credits_config 读取 default_credits（兼容模式）', {
            value: settings.credits_config.default_credits
          });
        }

        // 确保关键字段有默认值
        if (formattedSettings.user.require_invitation_code === undefined) {
          formattedSettings.user.require_invitation_code = false;
        }
        if (formattedSettings.user.default_tokens === undefined) {
          formattedSettings.user.default_tokens = DEFAULT_SETTINGS.user.default_tokens;
        }
        if (formattedSettings.user.default_credits === undefined) {
          formattedSettings.user.default_credits = DEFAULT_SETTINGS.user.default_credits;
        }

        // 清理旧字段名
        delete formattedSettings.user.default_token_quota;
        delete formattedSettings.user.default_credits_quota;
      }

      return formattedSettings;
    } catch (error) {
      logger.error('获取格式化配置失败:', error);
      // 兜底返回默认配置，确保前端不会崩溃
      return {
        site: { ...DEFAULT_SETTINGS.site },
        user: { ...DEFAULT_SETTINGS.user },
        ai: { ...DEFAULT_SETTINGS.ai },
        chat: { ...DEFAULT_SETTINGS.chat },
        email: DEFAULT_SETTINGS.email,
        login: { ...DEFAULT_SETTINGS.login },
        theme: DEFAULT_SETTINGS.theme,
        html_editor: DEFAULT_SETTINGS.html_editor,
        teaching_page_header_html: DEFAULT_SETTINGS.teaching_page_header_html
      };
    }
  }

  /**
   * 保存格式化的系统设置
   * 
   * @param {Object} formattedSettings - 格式化的配置对象
   * @returns {boolean} true 表示保存成功
   */
  static async saveFormattedSettings(formattedSettings) {
    try {
      // 清理用户配置
      if (formattedSettings.user) {
        const cleanedUserConfig = {
          allow_register: formattedSettings.user.allow_register !== false,
          require_invitation_code: formattedSettings.user.require_invitation_code === true,
          default_tokens: formattedSettings.user.default_tokens ?? DEFAULT_SETTINGS.user.default_tokens,
          default_credits: formattedSettings.user.default_credits ?? DEFAULT_SETTINGS.user.default_credits,
          default_group_id: formattedSettings.user.default_group_id ?? DEFAULT_SETTINGS.user.default_group_id
        };
        formattedSettings.user = cleanedUserConfig;

        logger.info('保存用户配置', cleanedUserConfig);
      }

      // 处理chat配置
      if (formattedSettings.chat) {
        formattedSettings.chat = {
          font_family: formattedSettings.chat.font_family || DEFAULT_SETTINGS.chat.font_family,
          font_size: formattedSettings.chat.font_size ?? DEFAULT_SETTINGS.chat.font_size
        };
      }

      // 处理登录配置
      if (formattedSettings.login) {
        formattedSettings.login = {
          mode: formattedSettings.login.mode || DEFAULT_SETTINGS.login.mode,
          refresh_token_days: formattedSettings.login.refresh_token_days ?? DEFAULT_SETTINGS.login.refresh_token_days
        };
      }

      // 构建要保存的配置键值对
      const settings = {
        site_config: formattedSettings.site,
        user_config: formattedSettings.user,
        ai_config: formattedSettings.ai,
        chat_config: formattedSettings.chat
      };

      if (formattedSettings.email !== undefined) {
        settings.email_config = formattedSettings.email;
      }

      if (formattedSettings.login !== undefined) {
        settings.login_config = formattedSettings.login;
      }

      if (formattedSettings.theme !== undefined) {
        settings.theme_config = formattedSettings.theme;
      }

      // 保存教学页面头部HTML配置
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
      }

      // 更新除 html_editor.* 之外的配置（html_editor 已在上面单独处理）
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
   * @returns {Object|null} 邮件SMTP配置
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
   * @param {Object} emailConfig - SMTP配置对象
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
   * @returns {Object} 登录配置，包含 mode 和 refresh_token_days
   */
  static async getLoginSettings() {
    try {
      const settings = await SystemConfig.getSetting('login_config');
      return settings || { ...DEFAULT_SETTINGS.login };
    } catch (error) {
      logger.error('获取登录配置失败:', error);
      return { ...DEFAULT_SETTINGS.login };
    }
  }

  /**
   * 更新登录配置
   * @param {Object} loginConfig - 登录配置对象
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
   * @returns {Object|null} 主题配色配置
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
   * @param {Object} themeConfig - 主题配色对象
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
