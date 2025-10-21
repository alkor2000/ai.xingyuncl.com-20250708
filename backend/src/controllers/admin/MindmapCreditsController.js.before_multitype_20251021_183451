/**
 * 思维导图积分配置控制器
 */
const SystemConfig = require('../../models/SystemConfig');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class MindmapCreditsController {
  /**
   * 获取思维导图积分配置
   */
  static async getConfig(req, res) {
    try {
      // 从系统配置中获取思维导图相关配置
      const saveCredits = await SystemConfig.getSetting('mindmap.save_credits') || 5;
      const exportSvgCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
      const exportMarkdownCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
      
      const config = {
        save_credits: saveCredits,
        export_svg_credits: exportSvgCredits,
        export_markdown_credits: exportMarkdownCredits
      };
      
      logger.info('获取思维导图积分配置', config);
      return ResponseHelper.success(res, config);
    } catch (error) {
      logger.error('获取思维导图积分配置失败:', error);
      return ResponseHelper.error(res, '获取配置失败');
    }
  }
  
  /**
   * 更新思维导图积分配置
   */
  static async updateConfig(req, res) {
    try {
      const { save_credits, export_svg_credits, export_markdown_credits } = req.body;
      
      // 验证参数范围 0-999
      if (save_credits < 0 || save_credits > 999 ||
          export_svg_credits < 0 || export_svg_credits > 999 ||
          export_markdown_credits < 0 || export_markdown_credits > 999) {
        return ResponseHelper.validation(res, ['积分值必须在0-999之间']);
      }
      
      // 更新配置
      await SystemConfig.updateSetting('mindmap.save_credits', save_credits, 'number');
      await SystemConfig.updateSetting('mindmap.export_svg_credits', export_svg_credits, 'number');
      await SystemConfig.updateSetting('mindmap.export_markdown_credits', export_markdown_credits, 'number');
      
      logger.info('思维导图积分配置已更新', { 
        save_credits, 
        export_svg_credits, 
        export_markdown_credits,
        updatedBy: req.user.id 
      });
      
      return ResponseHelper.success(res, null, '配置更新成功');
    } catch (error) {
      logger.error('更新思维导图积分配置失败:', error);
      return ResponseHelper.error(res, '更新配置失败');
    }
  }
  
  /**
   * 检查用户积分是否充足
   */
  static async checkCredits(req, res) {
    try {
      const { operation } = req.query; // save, export_svg, export_markdown
      const userId = req.user.id;
      
      // 获取操作所需积分
      let requiredCredits = 0;
      switch(operation) {
        case 'save':
          requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 5;
          break;
        case 'export_svg':
          requiredCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
          break;
        case 'export_markdown':
          requiredCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
          break;
        default:
          return ResponseHelper.validation(res, ['无效的操作类型']);
      }
      
      // 如果积分设置为0，表示不需要积分
      if (requiredCredits === 0) {
        return ResponseHelper.success(res, {
          sufficient: true,
          requiredCredits: 0,
          currentCredits: 0,
          message: '该操作无需消耗积分'
        });
      }
      
      // 获取用户信息
      const User = require('../../models/User');
      const user = await User.findById(userId);
      
      if (!user) {
        return ResponseHelper.error(res, '用户不存在');
      }
      
      const currentCredits = user.getCredits();
      const sufficient = user.hasCredits(requiredCredits);
      
      return ResponseHelper.success(res, {
        sufficient,
        requiredCredits,
        currentCredits,
        message: sufficient ? '积分充足' : '积分不足'
      });
    } catch (error) {
      logger.error('检查积分失败:', error);
      return ResponseHelper.error(res, '检查积分失败');
    }
  }
}

module.exports = MindmapCreditsController;
