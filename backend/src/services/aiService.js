/**
 * AI服务层 - 非流式版本
 * 负责与AI模型交互，支持Azure OpenAI、OpenRouter、标准OpenAI格式
 * 支持图片识别、PDF解析、图片生成（Gemini）
 * 
 * v2.0 变更：
 *   - processMessagesForOpenRouter: 支持 msg.image_urls 多图数组
 *   - processMessagesStandard: 支持 msg.image_urls 多图数组
 *   - 多图场景下生成多个 image_url content块
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const AIModel = require('../models/AIModel');
const ImageGenerationService = require('./imageGenerationService');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

class AIService {
  /**
   * 发送消息到AI模型 - 支持会话级temperature和图片/PDF
   */
  static async sendMessage(modelName, messages, options = {}) {
    try {
      logger.info('开始AI服务调用', {
        model: modelName,
        messageCount: messages.length,
        customTemperature: options.temperature,
        hasImages: messages.some(m => m.image_url || m.image_urls),
        hasPDFs: messages.some(m => m.file),
        messageId: options.messageId
      });

      const model = await AIModel.findByName(modelName);
      if (!model) {
        const allModels = await AIModel.getAvailableModels();
        const similarModel = allModels.find(m =>
          modelName.includes(m.name) || m.name.includes(modelName)
        );

        if (!similarModel) {
          throw new Error(`AI模型 ${modelName} 未找到或未启用`);
        }

        logger.info('使用相似模型', { requestedModel: modelName, foundModel: similarModel.name });
        return await AIService.callModelAPI(similarModel, messages, options);
      }

      return await AIService.callModelAPI(model, messages, options);
    } catch (error) {
      logger.error('AI服务调用失败:', error);
      throw new ExternalServiceError(`AI服务调用失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 解析Azure配置字符串（格式：api_key|endpoint|api_version）
   */
  static parseAzureConfig(configString) {
    const parts = configString.split('|');
    if (parts.length === 3) {
      return { apiKey: parts[0].trim(), endpoint: parts[1].trim(), apiVersion: parts[2].trim() };
    }
    return null;
  }

  /** 检测是否为Azure配置 */
  static isAzureConfig(model) {
    if (model.provider === 'azure' || model.provider === 'azure-openai') return true;
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|');
      if (parts.length === 3) return true;
    }
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') return true;
    return false;
  }

  /** 判断是否为OpenRouter端点 */
  static isOpenRouterEndpoint(endpoint) {
    return endpoint && endpoint.includes('openrouter');
  }

  /**
   * v2.0: 构建图片 content 块数组（支持单图和多图）
   * 根据provider生成对应格式的图片块
   * 
   * @param {string[]} urls - 图片URL数组
   * @param {string} provider - 模型provider
   * @returns {Object[]} content块数组
   */
  static _buildImageContentBlocks(urls, provider) {
    if (!urls || urls.length === 0) return [];

    return urls.map(url => {
      if (provider === 'anthropic') {
        // Claude格式
        return { type: 'image', source: { type: 'url', url: url } };
      } else {
        // OpenAI / OpenRouter / Gemini / 默认格式
        return { type: 'image_url', image_url: { url: url } };
      }
    });
  }

  /**
   * 处理消息为OpenRouter格式 - v2.0: 支持多图
   * @param {Object[]} messages - 消息数组
   * @param {Object} model - 模型配置
   * @returns {Object[]} 处理后的消息数组
   */
  static processMessagesForOpenRouter(messages, model) {
    return messages.map(msg => {
      // 如果消息包含PDF文件
      if (msg.file && msg.file.mime_type === 'application/pdf') {
        logger.info('处理PDF消息为OpenRouter格式', { role: msg.role });
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            { type: 'file', file: { filename: 'document.pdf', file_data: msg.file.url } }
          ]
        };
      }

      // v2.0: 收集所有图片URL（兼容单图和多图）
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      // 如果有图片且模型支持
      if (imageUrls.length > 0 && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        const imageBlocks = AIService._buildImageContentBlocks(imageUrls, 'openrouter');
        contentBlocks.push(...imageBlocks);

        logger.info('处理多图消息为OpenRouter格式', {
          role: msg.role, imageCount: imageUrls.length
        });

        return { role: msg.role, content: contentBlocks };
      }

      // 普通文本消息
      return { role: msg.role, content: msg.content };
    });
  }

  /**
   * 处理消息为标准格式（非OpenRouter）- v2.0: 支持多图
   * @param {Object[]} messages - 消息数组
   * @param {Object} model - 模型配置
   * @returns {Object[]} 处理后的消息数组
   */
  static processMessagesStandard(messages, model) {
    return messages.map(msg => {
      // v2.0: 收集所有图片URL（兼容单图和多图）
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      // 如果有图片且模型支持
      if (imageUrls.length > 0 && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        const imageBlocks = AIService._buildImageContentBlocks(imageUrls, model.provider);
        contentBlocks.push(...imageBlocks);

        logger.info('处理多图消息为标准格式', {
          role: msg.role, imageCount: imageUrls.length, provider: model.provider
        });

        return { role: msg.role, content: contentBlocks };
      }

      // 对于PDF文件，非OpenRouter只能作为文本处理
      if (msg.file) {
        logger.warn('非OpenRouter端点不支持PDF直接处理', { provider: model.provider });
        return { role: msg.role, content: `${msg.content}\n\n[附件: ${msg.file.url}]` };
      }

      return msg;
    });
  }

  /**
   * 调用Azure OpenAI API
   */
  static async callAzureAPI(model, messages, options = {}) {
    try {
      const azureConfig = AIService.parseAzureConfig(model.api_key);
      if (!azureConfig) throw new Error('Azure配置格式错误，应为: api_key|endpoint|api_version');

      const { apiKey, endpoint, apiVersion } = azureConfig;
      let deploymentName = model.name;
      if (model.name.includes('/')) {
        deploymentName = model.name.split('/').pop();
      }

      const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      logger.info('调用Azure OpenAI API', {
        model: model.name, deployment: deploymentName,
        endpoint: baseUrl, apiVersion, messageCount: messages.length
      });

      const modelConfig = model.getDefaultConfig();
      const requestConfig = { ...modelConfig, ...options };
      const finalTemperature = options.temperature !== undefined
        ? parseFloat(options.temperature) : (requestConfig.temperature || 0.7);

      const processedMessages = AIService.processMessagesStandard(messages, model);

      const requestData = {
        messages: processedMessages,
        temperature: finalTemperature,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: false
      };

      const response = await axios.post(azureUrl, requestData, {
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: 120000
      });

      return AIService.formatResponse(response.data, model, options);
    } catch (error) {
      logger.error('Azure API调用失败:', error);
      if (error.response) {
        logger.error('Azure API错误响应:', { status: error.response.status, data: error.response.data });
      }
      throw error;
    }
  }

  /**
   * 调用模型API - 支持会话级temperature和图片生成、PDF
   */
  static async callModelAPI(model, messages, options = {}) {
    try {
      if (AIService.isAzureConfig(model)) {
        logger.info('检测到Azure配置，使用Azure API调用');
        return await AIService.callAzureAPI(model, messages, options);
      }

      if (!model.api_key || !model.api_endpoint) {
        throw new Error(`模型 ${model.name} 的API密钥或端点未配置`);
      }

      const modelConfig = model.getDefaultConfig();
      const requestConfig = { ...modelConfig, ...options };
      const finalTemperature = options.temperature !== undefined
        ? parseFloat(options.temperature) : (requestConfig.temperature || 0.7);

      const isOpenRouter = AIService.isOpenRouterEndpoint(model.api_endpoint);

      logger.info('调用AI模型API', {
        model: model.name, endpoint: model.api_endpoint, isOpenRouter,
        messageCount: messages.length, temperature: finalTemperature,
        supportsImages: model.image_upload_enabled,
        supportsDocuments: model.document_upload_enabled,
        provider: model.provider,
        hasPDFs: messages.some(m => m.file),
        hasMultiImages: messages.some(m => m.image_urls)
      });

      let processedMessages;
      let plugins = undefined;

      if (isOpenRouter) {
        processedMessages = AIService.processMessagesForOpenRouter(messages, model);
        if (messages.some(m => m.file)) {
          plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }];
          logger.info('为PDF添加OpenRouter插件配置');
        }
      } else {
        processedMessages = AIService.processMessagesStandard(messages, model);
      }

      const requestData = {
        model: model.name,
        messages: processedMessages,
        temperature: finalTemperature,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: false
      };

      if (plugins) requestData.plugins = plugins;

      let headers = {
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Type': 'application/json'
      };

      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://ai.xingyuncl.com';
        headers['X-Title'] = 'AI Platform';
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions')
        ? model.api_endpoint : `${model.api_endpoint}/chat/completions`;

      const response = await axios.post(endpoint, requestData, { headers, timeout: 120000 });

      // 增强调试：保存完整响应
      if (model.image_generation_enabled || messages.some(m => m.file)) {
        const debugDir = '/var/www/ai-platform/logs/debug';
        await fs.mkdir(debugDir, { recursive: true });
        const debugFile = path.join(debugDir, `response_${Date.now()}.json`);
        await fs.writeFile(debugFile, JSON.stringify(response.data, null, 2));
        logger.info('【调试】API响应已保存', { file: debugFile });
      }

      return AIService.formatResponse(response.data, model, options);
    } catch (error) {
      logger.error('模型API调用失败:', error);
      if (error.response) logger.error('API错误响应:', error.response.data);
      throw error;
    }
  }

  /**
   * 格式化响应 - 支持图片生成（OpenRouter格式）
   */
  static async formatResponse(response, model, options = {}) {
    try {
      const isImageGenModel = ImageGenerationService.isImageGenerationModel(model);

      if (isImageGenModel && options.messageId) {
        logger.info('检测到图片生成模型响应，开始处理', {
          modelName: model.name, messageId: options.messageId
        });

        let processedResult = { content: '', images: [] };

        // 检查OpenRouter格式
        if (response.choices && response.choices[0] && response.choices[0].message) {
          const message = response.choices[0].message;

          if (message.content) processedResult.content = message.content;

          if (message.images && Array.isArray(message.images)) {
            processedResult = await ImageGenerationService.processOpenRouterImageResponse(
              response, options.messageId
            );
          }
        }
        // 尝试Gemini格式
        else if (response.candidates && response.candidates[0]) {
          processedResult = await ImageGenerationService.processGeminiImageResponse(
            response, options.messageId
          );
        }

        if (processedResult.images && processedResult.images.length > 0) {
          logger.info('成功处理生成的图片', {
            messageId: options.messageId, imageCount: processedResult.images.length
          });
          return {
            content: processedResult.content || '',
            generatedImages: processedResult.images,
            finish_reason: response.choices?.[0]?.finish_reason || response.candidates?.[0]?.finishReason,
            usage: response.usage,
            model: model.name
          };
        }
      }

      // 标准响应处理
      let content = '';
      let finish_reason = null;

      if (response.choices && response.choices[0]) {
        const choice = response.choices[0];
        content = choice.message?.content || '';
        finish_reason = choice.finish_reason;
      } else if (response.candidates && response.candidates[0]) {
        const candidate = response.candidates[0];
        if (candidate.content?.parts) {
          content = candidate.content.parts.filter(part => part.text).map(part => part.text).join('');
        }
        finish_reason = candidate.finishReason || 'stop';
      } else {
        throw new Error('AI响应格式错误: 没有找到choices或candidates');
      }

      return { content, finish_reason, usage: response.usage, model: model.name };
    } catch (error) {
      logger.error('格式化AI响应失败:', error);
      throw new Error(`格式化AI响应失败: ${error.message}`);
    }
  }

  /** 估算消息Token数量 */
  static estimateTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    return messages.reduce((total, message) => {
      const content = message.content || '';
      const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = content.length - chineseChars;
      const fileTokens = (message.image_url || message.image_urls || message.file) ? 100 : 0;
      return total + Math.ceil(chineseChars * 0.67 + otherChars * 0.25) + fileTokens;
    }, 0);
  }

  /** 获取可用的AI模型列表 */
  static async getAvailableModels() {
    try {
      return await AIModel.getAvailableModels();
    } catch (error) {
      logger.error('获取AI模型列表失败:', error);
      throw error;
    }
  }

  /** 验证模型是否可用 */
  static async validateModel(modelName) {
    try {
      const model = await AIModel.findByName(modelName);
      return !!(model && model.is_active);
    } catch (error) {
      logger.error('验证模型失败:', error);
      return false;
    }
  }

  /** 测试AI模型连接 */
  static async testModel(modelName) {
    try {
      const testMessages = [{ role: 'user', content: 'Hello, this is a test message. Please respond with "Test successful".' }];
      const response = await AIService.sendMessage(modelName, testMessages);
      return { success: true, response: response.content, model: modelName };
    } catch (error) {
      logger.error('测试模型失败:', error);
      return { success: false, error: error.message, model: modelName };
    }
  }
}

module.exports = AIService;
