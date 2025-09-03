/**
 * 站点配置服务
 */

const SystemConfig = require('../../models/SystemConfig');
const logger = require('../../utils/logger');

class SiteConfigService {
  /**
   * 获取用户的站点配置（包含组配置）
   */
  static async getUserSiteConfig(user) {
    try {
      // 获取系统默认配置
      const systemSettings = await SystemConfig.getFormattedSettings();
      const systemSiteConfig = systemSettings.site || {
        name: 'AI Platform',
        description: '企业级AI应用聚合平台',
        logo: '',
        favicon: ''
      };

      // 如果用户有组且组开启了自定义配置
      if (user.group_id && user.group_site_customization_enabled) {
        // 优先使用组配置，如果组配置为空则使用系统配置
        return {
          name: user.group_site_name || systemSiteConfig.name,
          logo: user.group_site_logo || systemSiteConfig.logo,
          description: systemSiteConfig.description,
          favicon: systemSiteConfig.favicon,
          is_group_config: true
        };
      }

      // 使用系统默认配置
      return {
        ...systemSiteConfig,
        is_group_config: false
      };
    } catch (error) {
      logger.error('获取用户站点配置失败:', error);
      // 返回默认配置
      return {
        name: 'AI Platform',
        description: '企业级AI应用聚合平台', 
        logo: '',
        favicon: '',
        is_group_config: false
      };
    }
  }
}

module.exports = SiteConfigService;
