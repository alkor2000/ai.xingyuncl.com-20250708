/**
 * 会话服务 - 处理会话的创建、更新、删除等业务逻辑
 */

const Conversation = require('../../models/Conversation');
const SystemPrompt = require('../../models/SystemPrompt');
const ModuleCombination = require('../../models/ModuleCombination');
const AIModel = require('../../models/AIModel');
const CacheService = require('../cacheService');
const logger = require('../../utils/logger');

class ConversationService {
  /**
   * 验证并准备会话数据
   */
  static async prepareConversationData(params) {
    const {
      userId,
      userGroupId,
      title,
      model_name,
      system_prompt,
      system_prompt_id,
      module_combination_id,
      context_length,
      ai_temperature,
      priority
    } = params;
    
    // 验证模型名称
    if (!model_name) {
      throw new Error('模型名称不能为空');
    }
    
    // 验证AI模型是否存在且启用
    const availableModels = await CacheService.getCachedUserModels(
      userId,
      userGroupId,
      async () => await AIModel.getUserAvailableModels(userId, userGroupId)
    );
    
    const aiModel = availableModels.find(m => m.name === model_name);
    if (!aiModel) {
      throw new Error('您无权使用该模型或模型不可用');
    }
    
    // 验证系统提示词权限
    if (system_prompt_id) {
      const availablePrompts = await SystemPrompt.getUserAvailablePrompts(userId, userGroupId);
      const canUsePrompt = availablePrompts.some(p => p.id === system_prompt_id);
      
      if (!canUsePrompt) {
        throw new Error('您无权使用该系统提示词');
      }
    }
    
    // 验证模块组合权限
    if (module_combination_id) {
      const combination = await ModuleCombination.findById(module_combination_id, userId);
      if (!combination) {
        throw new Error('模块组合不存在');
      }
      
      if (combination.user_id !== userId) {
        throw new Error('您无权使用该模块组合');
      }
    }
    
    // 验证并规范化参数
    const validContextLength = this.validateContextLength(context_length);
    const validTemperature = this.validateTemperature(ai_temperature);
    
    return {
      user_id: parseInt(userId),
      title: title || 'New Chat',
      model_name: model_name || 'gpt-3.5-turbo',
      system_prompt: system_prompt || null,
      system_prompt_id: system_prompt_id || null,
      module_combination_id: module_combination_id || null,
      context_length: validContextLength,
      ai_temperature: validTemperature,
      priority: parseInt(priority) || 0
    };
  }
  
  /**
   * 验证上下文长度
   */
  static validateContextLength(contextLength) {
    let validLength = parseInt(contextLength) || 20;
    if (validLength < 0) validLength = 0;
    if (validLength > 1000) validLength = 1000;
    return validLength;
  }
  
  /**
   * 验证temperature参数
   */
  static validateTemperature(temperature) {
    let validTemp = parseFloat(temperature);
    if (isNaN(validTemp)) validTemp = 0.0;
    if (validTemp < 0.0) validTemp = 0.0;
    if (validTemp > 1.0) validTemp = 1.0;
    return validTemp;
  }
  
  /**
   * 验证会话更新权限
   */
  static async validateUpdatePermissions(params) {
    const {
      conversation,
      model_name,
      system_prompt_id,
      module_combination_id,
      userId,
      userGroupId
    } = params;
    
    // 如果更换模型，验证新模型
    if (model_name && model_name !== conversation.model_name) {
      const availableModels = await CacheService.getCachedUserModels(
        userId,
        userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      
      const canUseModel = availableModels.some(m => m.name === model_name);
      if (!canUseModel) {
        throw new Error('您无权使用该模型');
      }
    }
    
    // 如果更换系统提示词，验证权限
    if (system_prompt_id !== undefined && system_prompt_id !== conversation.system_prompt_id) {
      if (system_prompt_id) {
        const availablePrompts = await SystemPrompt.getUserAvailablePrompts(userId, userGroupId);
        const canUsePrompt = availablePrompts.some(p => p.id === system_prompt_id);
        
        if (!canUsePrompt) {
          throw new Error('您无权使用该系统提示词');
        }
      }
    }
    
    // 如果更换模块组合，验证权限
    if (module_combination_id !== undefined && module_combination_id !== conversation.module_combination_id) {
      if (module_combination_id) {
        const combination = await ModuleCombination.findById(module_combination_id, userId);
        if (!combination) {
          throw new Error('模块组合不存在');
        }
        
        if (combination.user_id !== userId) {
          throw new Error('您无权使用该模块组合');
        }
      }
    }
  }
}

module.exports = ConversationService;
