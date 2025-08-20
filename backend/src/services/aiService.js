/**
 * AI服务层
 * 负责与AI模型交互（非流式版本）
 * 支持Azure OpenAI特殊配置
 */

const axios = require('axios');
const AIModel = require('../models/AIModel');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

class AIService {
  /**
   * 发送消息到AI模型 - 支持会话级temperature和图片
   */
  static async sendMessage(modelName, messages, options = {}) {
    try {
      logger.info('开始AI服务调用', { 
        model: modelName, 
        messageCount: messages.length,
        customTemperature: options.temperature,
        hasImages: messages.some(m => m.image_url)
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
   * 解析Azure配置字符串
   * 格式：api_key|endpoint|api_version
   */
  static parseAzureConfig(configString) {
    const parts = configString.split('|');
    if (parts.length === 3) {
      return {
        apiKey: parts[0].trim(),
        endpoint: parts[1].trim(),
        apiVersion: parts[2].trim()
      };
    }
    return null;
  }

  /**
   * 检测是否为Azure配置
   */
  static isAzureConfig(model) {
    // 1. 通过provider判断
    if (model.provider === 'azure' || model.provider === 'azure-openai') {
      return true;
    }
    
    // 2. 通过api_key格式判断（包含|分隔符）
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|');
      if (parts.length === 3) {
        return true;
      }
    }
    
    // 3. 通过endpoint判断
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') {
      return true;
    }
    
    return false;
  }

  /**
   * 调用Azure OpenAI API
   */
  static async callAzureAPI(model, messages, options = {}) {
    try {
      // 解析Azure配置
      const azureConfig = AIService.parseAzureConfig(model.api_key);
      if (!azureConfig) {
        throw new Error('Azure配置格式错误，应为: api_key|endpoint|api_version');
      }

      const { apiKey, endpoint, apiVersion } = azureConfig;

      // 从endpoint提取deployment名称
      // 格式: https://xxx.openai.azure.com 或 https://xxx.cognitiveservices.azure.com
      let deploymentName = model.name;
      
      // 如果model.name包含斜杠，取最后一部分作为deployment名称
      if (model.name.includes('/')) {
        const parts = model.name.split('/');
        deploymentName = parts[parts.length - 1];
      }

      // 构造Azure特定的URL
      const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      logger.info('调用Azure OpenAI API', {
        model: model.name,
        deployment: deploymentName,
        endpoint: baseUrl,
        apiVersion: apiVersion,
        messageCount: messages.length
      });

      // 合并配置
      const modelConfig = model.getDefaultConfig();
      const requestConfig = {
        ...modelConfig,
        ...options
      };

      const finalTemperature = options.temperature !== undefined ? 
        parseFloat(options.temperature) : 
        (requestConfig.temperature || 0.7);

      // 处理消息（Azure也支持图片）
      const processedMessages = messages.map(msg => {
        if (msg.image_url && model.image_upload_enabled) {
          return {
            role: msg.role,
            content: [
              { type: 'text', text: msg.content },
              { type: 'image_url', image_url: { url: msg.image_url } }
            ]
          };
        }
        return msg;
      });

      // 构造请求数据 - Azure不需要model字段
      const requestData = {
        messages: processedMessages,
        temperature: finalTemperature,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: false
      };

      // 发送请求 - 使用api-key头而不是Authorization Bearer
      const response = await axios.post(azureUrl, requestData, {
        headers: {
          'api-key': apiKey,  // Azure使用api-key头
          'Content-Type': 'application/json'
        },
        timeout: 120000
      });

      return AIService.formatResponse(response.data, model.name);
    } catch (error) {
      logger.error('Azure API调用失败:', error);
      
      if (error.response) {
        logger.error('Azure API错误响应:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      
      throw error;
    }
  }

  /**
   * 调用模型API - 支持会话级temperature和图片
   */
  static async callModelAPI(model, messages, options = {}) {
    try {
      // 检测是否为Azure配置
      if (AIService.isAzureConfig(model)) {
        logger.info('检测到Azure配置，使用Azure API调用');
        return await AIService.callAzureAPI(model, messages, options);
      }

      // 标准OpenAI API调用
      if (!model.api_key || !model.api_endpoint) {
        throw new Error(`模型 ${model.name} 的API密钥或端点未配置`);
      }

      // 合并配置 - 优先使用会话级temperature
      const modelConfig = model.getDefaultConfig();
      const requestConfig = {
        ...modelConfig,
        ...options
      };

      // 使用会话级temperature，如果没有则使用默认值0.7
      const finalTemperature = options.temperature !== undefined ? 
        parseFloat(options.temperature) : 
        (requestConfig.temperature || 0.7);

      logger.info('调用AI模型API', { 
        model: model.name, 
        endpoint: model.api_endpoint,
        messageCount: messages.length,
        temperature: finalTemperature,
        supportsImages: model.image_upload_enabled,
        provider: model.provider
      });

      // 处理包含图片的消息
      const processedMessages = messages.map(msg => {
        if (msg.image_url && model.image_upload_enabled) {
          // 根据不同的模型API格式处理图片
          if (model.provider === 'openai' || model.provider === 'google') {
            // OpenAI 和 Google 格式相同
            return {
              role: msg.role,
              content: [
                { type: 'text', text: msg.content },
                { type: 'image_url', image_url: { url: msg.image_url } }
              ]
            };
          } else if (model.provider === 'anthropic') {
            // Claude格式
            return {
              role: msg.role,
              content: [
                { type: 'text', text: msg.content },
                { 
                  type: 'image',
                  source: {
                    type: 'url',
                    url: msg.image_url
                  }
                }
              ]
            };
          } else {
            // 其他模型默认使用OpenAI格式
            return {
              role: msg.role,
              content: [
                { type: 'text', text: msg.content },
                { type: 'image_url', image_url: { url: msg.image_url } }
              ]
            };
          }
        }
        return msg;
      });

      // 记录处理后的消息（用于调试）
      if (messages.some(m => m.image_url)) {
        logger.info('处理后的图片消息', {
          provider: model.provider,
          processedMessage: JSON.stringify(processedMessages.find(m => 
            Array.isArray(m.content) && m.content.some(c => c.type === 'image_url' || c.type === 'image')
          ))
        });
      }

      // 构造请求数据 - 使用会话级temperature
      const requestData = {
        model: model.name,
        messages: processedMessages,
        temperature: finalTemperature,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: false
        // 完全移除 max_tokens 参数，让模型自由输出
      };

      const endpoint = model.api_endpoint.endsWith('/chat/completions') ? 
        model.api_endpoint : 
        `${model.api_endpoint}/chat/completions`;

      const response = await axios.post(endpoint, requestData, {
        headers: {
          'Authorization': `Bearer ${model.api_key}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 延长超时时间以支持图片处理和更长的输出
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
   * 格式化响应
   */
  static formatResponse(response, modelName) {
    try {
      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('AI响应格式错误: 没有找到choices');
      }

      return {
        content: choice.message?.content || '',
        finish_reason: choice.finish_reason,
        usage: response.usage,
        model: modelName
      };
    } catch (error) {
      logger.error('格式化AI响应失败:', error);
      throw new Error(`格式化AI响应失败: ${error.message}`);
    }
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
      
      // 如果有图片，额外增加token估算
      const imageTokens = message.image_url ? 100 : 0;
      
      return total + Math.ceil(chineseChars * 0.67 + otherChars * 0.25) + imageTokens;
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
      if (!model || !model.is_active) {
        return false;
      }
      return true;
    } catch (error) {
      logger.error('验证模型失败:', error);
      return false;
    }
  }

  /**
   * 测试AI模型连接
   */
  static async testModel(modelName) {
    try {
      const testMessages = [
        {
          role: 'user',
          content: 'Hello, this is a test message. Please respond with "Test successful".'
        }
      ];

      const response = await AIService.sendMessage(modelName, testMessages);
      
      return {
        success: true,
        response: response.content,
        model: modelName
      };
    } catch (error) {
      logger.error('测试模型失败:', error);
      return {
        success: false,
        error: error.message,
        model: modelName
      };
    }
  }
}

module.exports = AIService;
