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
      // 获取AI模型配置
      const model = await AIModel.findByName(modelName);
      if (!model) {
        throw new Error(`AI模型 ${modelName} 未找到或未启用`);
      }

      // 合并配置
      const modelConfig = model.getDefaultConfig();
      const requestConfig = {
        ...modelConfig,
        ...options
      };

      logger.info('发送AI请求', { 
        model: modelName, 
        provider: model.provider,
        messageCount: messages.length 
      });

      // 根据提供商调用相应的API
      switch (model.provider.toLowerCase()) {
        case 'openai':
          return await AIService.callOpenAI(model, messages, requestConfig);
        case 'anthropic':
          return await AIService.callAnthropic(model, messages, requestConfig);
        case 'oneapi':
          return await AIService.callOneAPI(model, messages, requestConfig);
        default:
          throw new Error(`不支持的AI提供商: ${model.provider}`);
      }
    } catch (error) {
      logger.error('AI服务调用失败:', error);
      throw new ExternalServiceError(`AI服务调用失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 调用OpenAI API
   */
  static async callOpenAI(model, messages, requestConfig) {
    const apiKey = config.ai.openai.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI API密钥未配置');
    }

    const requestData = {
      model: model.name,
      messages: messages,
      max_tokens: requestConfig.max_tokens,
      temperature: requestConfig.temperature,
      top_p: requestConfig.top_p,
      presence_penalty: requestConfig.presence_penalty,
      frequency_penalty: requestConfig.frequency_penalty,
      stream: false
    };

    const response = await axios.post(
      `${config.ai.openai.baseURL}/chat/completions`,
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(config.ai.openai.orgId && { 'OpenAI-Organization': config.ai.openai.orgId })
        },
        timeout: config.ai.openai.timeout
      }
    );

    return AIService.formatOpenAIResponse(response.data);
  }

  /**
   * 调用Anthropic API
   */
  static async callAnthropic(model, messages, requestConfig) {
    const apiKey = config.ai.anthropic.apiKey;
    if (!apiKey) {
      throw new Error('Anthropic API密钥未配置');
    }

    // 转换消息格式（Anthropic格式可能不同）
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const requestData = {
      model: model.name,
      max_tokens: requestConfig.max_tokens,
      temperature: requestConfig.temperature,
      messages: conversationMessages,
      ...(systemMessage && { system: systemMessage.content })
    };

    const response = await axios.post(
      `${config.ai.anthropic.baseURL}/messages`,
      requestData,
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        timeout: config.ai.anthropic.timeout
      }
    );

    return AIService.formatAnthropicResponse(response.data);
  }

  /**
   * 调用OneAPI (统一接口)
   */
  static async callOneAPI(model, messages, requestConfig) {
    const apiKey = config.ai.oneapi.apiKey;
    const baseURL = config.ai.oneapi.baseURL;
    
    if (!apiKey || !baseURL) {
      throw new Error('OneAPI配置未完整设置');
    }

    const requestData = {
      model: model.name,
      messages: messages,
      max_tokens: requestConfig.max_tokens,
      temperature: requestConfig.temperature,
      top_p: requestConfig.top_p,
      presence_penalty: requestConfig.presence_penalty,
      frequency_penalty: requestConfig.frequency_penalty,
      stream: false
    };

    const response = await axios.post(
      `${baseURL}/chat/completions`,
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: config.ai.oneapi.timeout
      }
    );

    return AIService.formatOpenAIResponse(response.data);
  }

  /**
   * 格式化OpenAI响应
   */
  static formatOpenAIResponse(responseData) {
    const choice = responseData.choices?.[0];
    if (!choice) {
      throw new Error('AI响应格式错误：缺少选择项');
    }

    return {
      content: choice.message?.content || '',
      role: choice.message?.role || 'assistant',
      finish_reason: choice.finish_reason,
      usage: responseData.usage || {},
      model: responseData.model,
      created: responseData.created
    };
  }

  /**
   * 格式化Anthropic响应
   */
  static formatAnthropicResponse(responseData) {
    const content = responseData.content?.[0];
    if (!content) {
      throw new Error('AI响应格式错误：缺少内容');
    }

    return {
      content: content.text || '',
      role: 'assistant',
      finish_reason: responseData.stop_reason,
      usage: responseData.usage || {},
      model: responseData.model,
      created: Date.now()
    };
  }

  /**
   * 估算消息Token数量
   */
  static estimateTokens(messages) {
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
    const model = await AIModel.findByName(modelName);
    return !!model;
  }
}

module.exports = AIService;
