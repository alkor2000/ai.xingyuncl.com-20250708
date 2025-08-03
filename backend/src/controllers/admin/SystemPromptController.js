/**
 * 系统提示词管理控制器
 */

const SystemPrompt = require('../../models/SystemPrompt');
const SystemConfig = require('../../models/SystemConfig');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class SystemPromptController {
  /**
   * 获取系统提示词列表
   */
  static async getSystemPrompts(req, res) {
    try {
      const { include_inactive = false } = req.query;
      
      const prompts = await SystemPrompt.getAll(include_inactive === 'true');
      
      return ResponseHelper.success(res, prompts, '获取系统提示词列表成功');
    } catch (error) {
      logger.error('获取系统提示词列表失败', { 
        error: error.message,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取系统提示词列表失败');
    }
  }

  /**
   * 获取单个系统提示词详情
   */
  static async getSystemPrompt(req, res) {
    try {
      const { id } = req.params;
      
      const prompt = await SystemPrompt.findById(id);
      
      if (!prompt) {
        return ResponseHelper.notFound(res, '系统提示词不存在');
      }
      
      return ResponseHelper.success(res, prompt.toJSON(true), '获取系统提示词详情成功');
    } catch (error) {
      logger.error('获取系统提示词详情失败', { 
        error: error.message,
        promptId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取系统提示词详情失败');
    }
  }

  /**
   * 创建系统提示词
   */
  static async createSystemPrompt(req, res) {
    try {
      const { name, description, content, is_active = 1, sort_order = 0, group_ids = [] } = req.body;
      
      // 验证必填字段
      if (!name || !content) {
        return ResponseHelper.validation(res, ['名称和内容不能为空']);
      }
      
      const prompt = await SystemPrompt.create({
        name,
        description,
        content,
        is_active,
        sort_order,
        group_ids
      }, req.user.id);
      
      return ResponseHelper.success(res, prompt.toJSON(true), '创建系统提示词成功', 201);
    } catch (error) {
      logger.error('创建系统提示词失败', { 
        error: error.message,
        userId: req.user?.id,
        data: req.body 
      });
      return ResponseHelper.error(res, '创建系统提示词失败');
    }
  }

  /**
   * 更新系统提示词
   */
  static async updateSystemPrompt(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const prompt = await SystemPrompt.update(id, updateData, req.user.id);
      
      return ResponseHelper.success(res, prompt.toJSON(true), '更新系统提示词成功');
    } catch (error) {
      logger.error('更新系统提示词失败', { 
        error: error.message,
        promptId: req.params.id,
        userId: req.user?.id,
        data: req.body 
      });
      return ResponseHelper.error(res, '更新系统提示词失败');
    }
  }

  /**
   * 删除系统提示词
   */
  static async deleteSystemPrompt(req, res) {
    try {
      const { id } = req.params;
      
      await SystemPrompt.delete(id);
      
      return ResponseHelper.success(res, null, '删除系统提示词成功');
    } catch (error) {
      logger.error('删除系统提示词失败', { 
        error: error.message,
        promptId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '删除系统提示词失败');
    }
  }

  /**
   * 切换系统提示词功能开关
   */
  static async toggleSystemPromptsFeature(req, res) {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return ResponseHelper.validation(res, ['enabled参数必须是布尔值']);
      }
      
      await SystemConfig.updateSetting('system_prompts_enabled', enabled ? 'true' : 'false', 'boolean');
      
      logger.info('系统提示词功能开关已更新', {
        enabled,
        operatorId: req.user.id
      });
      
      return ResponseHelper.success(res, { enabled }, enabled ? '系统提示词功能已启用' : '系统提示词功能已禁用');
    } catch (error) {
      logger.error('切换系统提示词功能失败', { 
        error: error.message,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '切换系统提示词功能失败');
    }
  }

  /**
   * 获取系统提示词功能状态
   */
  static async getSystemPromptsStatus(req, res) {
    try {
      const enabled = await SystemConfig.getSetting('system_prompts_enabled');
      
      return ResponseHelper.success(res, {
        enabled: enabled === 'true'
      }, '获取系统提示词功能状态成功');
    } catch (error) {
      logger.error('获取系统提示词功能状态失败', { 
        error: error.message,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取系统提示词功能状态失败');
    }
  }
}

module.exports = SystemPromptController;
