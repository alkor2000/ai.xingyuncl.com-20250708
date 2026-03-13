/**
 * AI服务层 - 非流式版本
 * 
 * 职责：
 * 1. 与AI模型交互（Azure OpenAI / OpenRouter / 标准OpenAI格式）
 * 2. 消息格式化（图片/PDF/多图适配）
 * 3. 图片生成响应处理（Gemini / OpenRouter）
 * 
 * 安全设计：
 * - 模型找不到时直接报错，不做静默替换（防止积分消耗不一致）
 * - 调试文件使用 config 配置路径，限制最大文件数量
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const AIModel = require('../models/AIModel');
const ImageGenerationService = require('./imageGenerationService');
const config = require('../config');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

/**
 * 调试响应文件最大保留数量
 * 超过此数量时删除最旧的文件，防止磁盘被填满
 */
const MAX_DEBUG_FILES = 50;

class AIService {
  /**
   * 发送消息到AI模型
   * 
   * @param {string} modelName - 模型名称（必须精确匹配）
   * @param {Object[]} messages - 消息数组
   * @param {Object} options - 选项（temperature, messageId 等）
   * @returns {Object} { content, finish_reason, usage, model }
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
        // 不做相似模型回退，直接报错
        // 原因：不同模型积分消耗不同，静默替换会导致用户被扣错积分
        throw new Error(`AI模型 ${modelName} 未找到或未启用，请在会话设置中选择其他模型`);
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
   * 构建图片 content 块数组（支持单图和多图）
   * 根据 provider 生成对应格式的图片块
   * 
   * @param {string[]} urls - 图片URL数组
   * @param {string} provider - 模型 provider
   * @returns {Object[]} content 块数组
   */
  static _buildImageContentBlocks(urls, provider) {
    if (!urls || urls.length === 0) return [];

    return urls.map(url => {
      if (provider === 'anthropic') {
        return { type: 'image', source: { type: 'url', url: url } };
      } else {
        return { type: 'image_url', image_url: { url: url } };
      }
    });
  }

  /**
   * 处理消息为 OpenRouter 格式 - 支持多图和PDF
   */
  static processMessagesForOpenRouter(messages, model) {
    return messages.map(msg => {
      // PDF文件
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

      // 收集所有图片URL（兼容单图和多图）
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      // 图片消息
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
   * 处理消息为标准格式（非OpenRouter）- 支持多图
   */
  static processMessagesStandard(messages, model) {
    return messages.map(msg => {
      // 收集所有图片URL
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      // 图片消息
      if (imageUrls.length > 0 && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        const imageBlocks = AIService._buildImageContentBlocks(imageUrls, model.provider);
        contentBlocks.push(...imageBlocks);

        logger.info('处理多图消息为标准格式', {
          role: msg.role, imageCount: imageUrls.length, provider: model.provider
        });

        return { role: msg.role, content: contentBlocks };
      }

      // PDF文件在非OpenRouter下作为文本附件
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
   * 保存调试响应文件（限制数量防止磁盘满）
   * 
   * @param {Object} responseData - API响应数据
   */
  static async _saveDebugResponse(responseData) {
    try {
      // 使用 config 中的日志目录，兼容 Docker 和 PM2
      const debugDir = path.join(config.logging.dirname, 'debug');
      await fs.mkdir(debugDir, { recursive: true });

      const debugFile = path.join(debugDir, `response_${Date.now()}.json`);
      await fs.writeFile(debugFile, JSON.stringify(responseData, null, 2));
      logger.info('调试响应已保存', { file: debugFile });

      // 清理旧文件，保留最新的 MAX_DEBUG_FILES 个
      try {
        const files = await fs.readdir(debugDir);
        const jsonFiles = files
          .filter(f => f.startsWith('response_') && f.endsWith('.json'))
          .sort();

        if (jsonFiles.length > MAX_DEBUG_FILES) {
          const filesToDelete = jsonFiles.slice(0, jsonFiles.length - MAX_DEBUG_FILES);
          for (const f of filesToDelete) {
            await fs.unlink(path.join(debugDir, f));
          }
          logger.info('清理旧调试文件', { deleted: filesToDelete.length, remaining: MAX_DEBUG_FILES });
        }
      } catch (cleanupErr) {
        logger.warn('清理调试文件失败:', cleanupErr.message);
      }
    } catch (err) {
      logger.warn('保存调试响应失败:', err.message);
    }
  }

  /**
   * 调用模型API - 支持会话级 temperature 和图片生成、PDF
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

      // 使用 config 中的域名，避免硬编码
      const siteDomain = config.app.domain || 'ai.xingyuncl.com';
      const siteName = config.app.name || 'AI Platform';

      let headers = {
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Type': 'application/json'
      };

      if (isOpenRouter) {
        headers['HTTP-Referer'] = `https://${siteDomain}`;
        headers['X-Title'] = siteName;
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions')
        ? model.api_endpoint : `${model.api_endpoint}/chat/completions`;

      const response = await axios.post(endpoint, requestData, { headers, timeout: 120000 });

      // 调试响应保存（仅图片生成或PDF场景，使用 config 路径+限制文件数量）
      if (model.image_generation_enabled || messages.some(m => m.file)) {
        await AIService._saveDebugResponse(response.data);
      }

      return AIService.formatResponse(response.data, model, options);
    } catch (error) {
      logger.error('模型API调用失败:', error);
      if (error.response) logger.error('API错误响应:', error.response.data);
      throw error;
    }
  }

  /**
   * 格式化响应 - 支持图片生成（OpenRouter / Gemini 格式）
   */
  static async formatResponse(response, model, options = {}) {
    try {
      const isImageGenModel = ImageGenerationService.isImageGenerationModel(model);

      if (isImageGenModel && options.messageId) {
        logger.info('检测到图片生成模型响应，开始处理', {
          modelName: model.name, messageId: options.messageId
        });

        let processedResult = { content: '', images: [] };

        if (response.choices && response.choices[0] && response.choices[0].message) {
          const message = response.choices[0].message;

          if (message.content) processedResult.content = message.content;

          if (message.images && Array.isArray(message.images)) {
            processedResult = await ImageGenerationService.processOpenRouterImageResponse(
              response, options.messageId
            );
          }
        } else if (response.candidates && response.candidates[0]) {
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

  /** 估算消息 Token 数量 */
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
