/**
 * AI服务
 * 统一管理不同AI模型的调用
 */

const axios = require('axios');
const config = require('../config');
const AIModel = require('../models/AIModel');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

class AIService {
  /**
   * 发送消息到AI模型
   */
  static async sendMessage(modelName, messages, options = {}) {
    try {
      logger.info('开始AI服务调用', { 
        model: modelName, 
        messageCount: messages.length 
      });

      // 获取AI模型配置
      const model = await AIModel.findByName(modelName);
      if (!model) {
        // 如果找不到精确匹配，尝试根据名称查找类似的
        const allModels = await AIModel.getAvailableModels();
        const similarModel = allModels.find(m => 
          modelName.includes(m.name) || m.name.includes(modelName)
        );
        
        if (!similarModel) {
          throw new Error(`AI模型 ${modelName} 未找到或未启用`);
        }
        
        logger.info('使用相似模型', { 
          requestedModel: modelName,
          foundModel: similarModel.name
        });
        
        // 使用找到的相似模型
        return await AIService.callModelAPI(similarModel, messages, options);
      }

      return await AIService.callModelAPI(model, messages, options);
    } catch (error) {
      logger.error('AI服务调用失败:', error);
      throw new ExternalServiceError(`AI服务调用失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 调用模型API
   */
  static async callModelAPI(model, messages, options = {}) {
    try {
      if (!model.api_key || !model.api_endpoint) {
        throw new Error(`模型 ${model.name} 的API密钥或端点未配置`);
      }

      // 合并配置
      const modelConfig = model.getDefaultConfig();
      const requestConfig = {
        ...modelConfig,
        ...options
      };

      logger.info('调用AI模型API', { 
        model: model.name, 
        endpoint: model.api_endpoint,
        messageCount: messages.length 
      });

      // 构造请求数据
      const requestData = {
        model: model.name,
        messages: messages,
        max_tokens: requestConfig.max_tokens || 4096,
        temperature: requestConfig.temperature || 0.7,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: false
      };

      const endpoint = model.api_endpoint.endsWith('/chat/completions') ? 
        model.api_endpoint : 
        `${model.api_endpoint}/chat/completions`;

      const response = await axios.post(endpoint, requestData, {
        headers: {
          'Authorization': `Bearer ${model.api_key}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      return AIService.formatResponse(response.data, model.name);
    } catch (error) {
      logger.error('模型API调用失败:', error);
      
      if (error.response) {
        logger.error('API错误响应:', error.response.data);
      }
      
      throw error;
    }
  }

  /**
   * 格式化AI响应
   */
  static formatResponse(responseData, modelName) {
    const choice = responseData.choices?.[0];
    if (!choice) {
      throw new Error('AI响应格式错误：缺少选择项');
    }

    return {
      content: choice.message?.content || choice.text || '',
      role: choice.message?.role || 'assistant',
      finish_reason: choice.finish_reason,
      usage: responseData.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      model: responseData.model || modelName,
      created: responseData.created || Date.now()
    };
  }

  /**
   * 估算消息Token数量
   */
  static estimateTokens(messages) {
    if (!Array.isArray(messages)) {
      return 0;
    }
    
    return messages.reduce((total, message) => {
      const content = message.content || '';
      // 简单估算：英文约4字符=1token，中文约1.5字符=1token
      const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = content.length - chineseChars;
      return total + Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
    }, 0);
  }

  /**
   * 获取可用的AI模型列表
   */
  static async getAvailableModels() {
    try {
      return await AIModel.getAvailableModels();
    } catch (error) {
      logger.error('获取AI模型列表失败:', error);
      throw error;
    }
  }

  /**
   * 验证模型是否可用
   */
  static async validateModel(modelName) {
    try {
      const model = await AIModel.findByName(modelName);
      if (model) {
        return true;
      }
      
      // 尝试查找相似模型
      const allModels = await AIModel.getAvailableModels();
      return allModels.some(m => 
        modelName.includes(m.name) || m.name.includes(modelName)
      );
    } catch (error) {
      logger.error('验证模型失败:', error);
      return false;
    }
  }
}

module.exports = AIService;
