/**
 * 日历配置管理Controller - 超级管理员专用
 */

const CalendarConfig = require('../../models/CalendarConfig');
const CalendarPromptTemplate = require('../../models/CalendarPromptTemplate');
const { ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class CalendarConfigController {
  /**
   * 获取日历配置
   */
  static async getConfig(req, res, next) {
    try {
      const config = await CalendarConfig.getConfig();
      const templates = await CalendarPromptTemplate.getAll();
      
      res.json({
        success: true,
        data: {
          config: config.toJSON(),
          templates: templates.map(t => t.toJSON())
        }
      });
    } catch (error) {
      logger.error('获取日历配置失败:', error);
      next(error);
    }
  }

  /**
   * 更新积分倍数
   */
  static async updateConfig(req, res, next) {
    try {
      const { credits_multiplier } = req.body;
      
      if (!credits_multiplier) {
        throw new ValidationError('积分倍数不能为空');
      }
      
      const config = await CalendarConfig.updateConfig({ credits_multiplier });
      
      logger.info('日历配置更新成功', {
        userId: req.user.id,
        credits_multiplier
      });
      
      res.json({
        success: true,
        data: config.toJSON(),
        message: '配置更新成功'
      });
    } catch (error) {
      logger.error('更新日历配置失败:', error);
      next(error);
    }
  }

  /**
   * 获取所有模板
   */
  static async getTemplates(req, res, next) {
    try {
      const templates = await CalendarPromptTemplate.getAll();
      
      res.json({
        success: true,
        data: templates.map(t => t.toJSON())
      });
    } catch (error) {
      logger.error('获取模板列表失败:', error);
      next(error);
    }
  }

  /**
   * 创建新模板
   */
  static async createTemplate(req, res, next) {
    try {
      const { name, prompt, description, is_default, display_order } = req.body;
      
      if (!name || !prompt) {
        throw new ValidationError('模板名称和提示词不能为空');
      }
      
      const template = await CalendarPromptTemplate.create({
        name,
        prompt,
        description,
        is_default: is_default || false,
        display_order: display_order || 0
      });
      
      logger.info('日历模板创建成功', {
        userId: req.user.id,
        templateId: template.id,
        name
      });
      
      res.json({
        success: true,
        data: template.toJSON(),
        message: '模板创建成功'
      });
    } catch (error) {
      logger.error('创建日历模板失败:', error);
      next(error);
    }
  }

  /**
   * 更新模板
   */
  static async updateTemplate(req, res, next) {
    try {
      const { id } = req.params;
      const { name, prompt, description, is_default, display_order, is_active } = req.body;
      
      const template = await CalendarPromptTemplate.findById(id);
      if (!template) {
        throw new ValidationError('模板不存在');
      }
      
      await template.update({
        name,
        prompt,
        description,
        is_default,
        display_order,
        is_active
      });
      
      logger.info('日历模板更新成功', {
        userId: req.user.id,
        templateId: id
      });
      
      const updatedTemplate = await CalendarPromptTemplate.findById(id);
      
      res.json({
        success: true,
        data: updatedTemplate.toJSON(),
        message: '模板更新成功'
      });
    } catch (error) {
      logger.error('更新日历模板失败:', error);
      next(error);
    }
  }

  /**
   * 删除模板
   */
  static async deleteTemplate(req, res, next) {
    try {
      const { id } = req.params;
      
      const template = await CalendarPromptTemplate.findById(id);
      if (!template) {
        throw new ValidationError('模板不存在');
      }
      
      await template.delete();
      
      logger.info('日历模板删除成功', {
        userId: req.user.id,
        templateId: id
      });
      
      res.json({
        success: true,
        message: '模板删除成功'
      });
    } catch (error) {
      logger.error('删除日历模板失败:', error);
      next(error);
    }
  }

  /**
   * 设置默认模板
   */
  static async setDefaultTemplate(req, res, next) {
    try {
      const { id } = req.params;
      
      const template = await CalendarPromptTemplate.findById(id);
      if (!template) {
        throw new ValidationError('模板不存在');
      }
      
      await template.setAsDefault();
      
      logger.info('默认模板设置成功', {
        userId: req.user.id,
        templateId: id
      });
      
      res.json({
        success: true,
        message: '默认模板设置成功'
      });
    } catch (error) {
      logger.error('设置默认模板失败:', error);
      next(error);
    }
  }
}

module.exports = CalendarConfigController;
