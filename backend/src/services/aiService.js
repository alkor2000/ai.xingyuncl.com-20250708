/**
 * AI服务层 - 增强PDF支持版本
 * 负责与AI模型交互（非流式版本）
 * 支持Azure OpenAI、Gemini图片生成和OpenRouter PDF格式
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
        hasImages: messages.some(m => m.image_url),
        hasPDFs: messages.some(m => m.file),
        messageId: options.messageId
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
   * 判断是否为OpenRouter端点
   */
  static isOpenRouterEndpoint(endpoint) {
    return endpoint && endpoint.includes('openrouter');
  }

  /**
   * 处理消息为OpenRouter格式 - 支持PDF
   */
  static processMessagesForOpenRouter(messages, model) {
    return messages.map(msg => {
      // 如果消息包含PDF文件
      if (msg.file && msg.file.mime_type === 'application/pdf') {
        logger.info('处理PDF消息为OpenRouter格式', {
          role: msg.role,
          hasFile: true,
          fileUrl: msg.file.url
        });
        
        // OpenRouter的PDF格式：使用content数组
        return {
          role: msg.role,
          content: [
            {
              type: 'text',
              text: msg.content
            },
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: msg.file.url
              }
            }
          ]
        };
      }
      
      // 如果消息包含图片
      if (msg.image_url && model.image_upload_enabled) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            { type: 'image_url', image_url: { url: msg.image_url } }
          ]
        };
      }
      
      // 普通文本消息
      return {
        role: msg.role,
        content: msg.content
      };
    });
  }

  /**
   * 处理消息为标准格式（非OpenRouter）
   */
  static processMessagesStandard(messages, model) {
    return messages.map(msg => {
      // 如果消息包含图片
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
      
      // 对于PDF文件，在非OpenRouter的情况下，只能作为文本处理
      if (msg.file) {
        logger.warn('非OpenRouter端点不支持PDF直接处理', {
          provider: model.provider,
          endpoint: model.api_endpoint
        });
        // 可以考虑在content中添加文件URL说明
        return {
          role: msg.role,
          content: `${msg.content}\n\n[附件: ${msg.file.url}]`
        };
      }
      
      return msg;
    });
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

      // 处理消息（Azure不支持PDF，但支持图片）
      const processedMessages = AIService.processMessagesStandard(messages, model);

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

      return AIService.formatResponse(response.data, model, options);
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
   * 调用模型API - 支持会话级temperature和图片生成、PDF
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

      // 检查是否为OpenRouter
      const isOpenRouter = AIService.isOpenRouterEndpoint(model.api_endpoint);
      
      logger.info('调用AI模型API', { 
        model: model.name, 
        endpoint: model.api_endpoint,
        isOpenRouter,
        messageCount: messages.length,
        temperature: finalTemperature,
        supportsImages: model.image_upload_enabled,
        supportsDocuments: model.document_upload_enabled,
        supportsImageGeneration: model.image_generation_enabled,
        provider: model.provider,
        hasPDFs: messages.some(m => m.file)
      });

      // 根据端点类型处理消息
      let processedMessages;
      let plugins = undefined;
      
      if (isOpenRouter) {
        processedMessages = AIService.processMessagesForOpenRouter(messages, model);
        
        // 如果有PDF文件，添加plugins配置
        if (messages.some(m => m.file)) {
          plugins = [
            {
              id: 'file-parser',
              pdf: {
                engine: 'pdf-text'  // 使用免费的pdf-text引擎
              }
            }
          ];
          logger.info('为PDF添加OpenRouter插件配置', { engine: 'pdf-text' });
        }
      } else {
        processedMessages = AIService.processMessagesStandard(messages, model);
      }

      // 记录处理后的消息（用于调试）
      if (messages.some(m => m.image_url || m.file)) {
        logger.info('处理后的文件消息', {
          provider: model.provider,
          isOpenRouter,
          hasProcessedPDF: processedMessages.some(m => 
            Array.isArray(m.content) && m.content.some(c => c.type === 'file')
          ),
          hasProcessedImage: processedMessages.some(m => 
            Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
          )
        });
      }

      // 构造请求数据
      const requestData = {
        model: model.name,
        messages: processedMessages,
        temperature: finalTemperature,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: false
      };

      // 如果有plugins配置（OpenRouter PDF），添加到请求
      if (plugins) {
        requestData.plugins = plugins;
      }

      // 设置请求头
      let headers = {
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Type': 'application/json'
      };
      
      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://ai.xingyuncl.com';
        headers['X-Title'] = 'AI Platform';
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions') ? 
        model.api_endpoint : 
        `${model.api_endpoint}/chat/completions`;

      const response = await axios.post(endpoint, requestData, {
        headers,
        timeout: 120000 // 延长超时时间以支持PDF处理
      });

      // 增强调试：保存完整响应
      if (model.image_generation_enabled || messages.some(m => m.file)) {
        const debugDir = '/var/www/ai-platform/logs/debug';
        await fs.mkdir(debugDir, { recursive: true });
        const debugFile = path.join(debugDir, `response_${Date.now()}.json`);
        await fs.writeFile(debugFile, JSON.stringify(response.data, null, 2));
        
        logger.info('【调试】API响应已保存', {
          file: debugFile,
          endpoint: model.api_endpoint,
          modelName: model.name,
          hadPDF: messages.some(m => m.file)
        });
      }

      return AIService.formatResponse(response.data, model, options);
    } catch (error) {
      logger.error('模型API调用失败:', error);
      
      if (error.response) {
        logger.error('API错误响应:', error.response.data);
      }
      
      throw error;
    }
  }

  /**
   * 格式化响应 - 支持图片生成（OpenRouter格式）
   */
  static async formatResponse(response, model, options = {}) {
    try {
      // 检查是否为图片生成模型
      const isImageGenModel = ImageGenerationService.isImageGenerationModel(model);
      
      if (isImageGenModel && options.messageId) {
        logger.info('检测到图片生成模型响应，开始处理', {
          modelName: model.name,
          messageId: options.messageId,
          provider: model.provider
        });
        
        let processedResult = { content: '', images: [] };
        
        // 1. 检查OpenRouter格式（choices[0].message.images）
        if (response.choices && response.choices[0] && response.choices[0].message) {
          const message = response.choices[0].message;
          
          logger.info('【格式化调试】检查message内容', {
            hasContent: !!message.content,
            hasImages: !!message.images,
            messageKeys: Object.keys(message)
          });
          
          // 提取文本内容
          if (message.content) {
            processedResult.content = message.content;
          }
          
          // 检查是否有images字段（OpenRouter格式）
          if (message.images && Array.isArray(message.images)) {
            logger.info('【格式化调试】找到images数组', {
              messageId: options.messageId,
              imageCount: message.images.length
            });
            
            processedResult = await ImageGenerationService.processOpenRouterImageResponse(
              response,
              options.messageId
            );
          }
        }
        // 2. 尝试原始Gemini格式 (candidates)
        else if (response.candidates && response.candidates[0]) {
          logger.info('使用Gemini格式解析响应');
          processedResult = await ImageGenerationService.processGeminiImageResponse(
            response,
            options.messageId
          );
        }
        
        // 如果有生成的图片，返回特殊格式
        if (processedResult.images && processedResult.images.length > 0) {
          logger.info('成功处理生成的图片', {
            messageId: options.messageId,
            imageCount: processedResult.images.length,
            images: processedResult.images.map(img => ({
              filename: img.filename,
              size: img.size
            }))
          });
          
          return {
            content: processedResult.content || '',
            generatedImages: processedResult.images,
            finish_reason: response.choices?.[0]?.finish_reason || response.candidates?.[0]?.finishReason,
            usage: response.usage,
            model: model.name
          };
        } else {
          logger.warn('图片生成模型响应中没有找到图片', {
            modelName: model.name,
            hasContent: !!processedResult.content,
            responseHasImages: !!(response.choices?.[0]?.message?.images)
          });
        }
      }
      
      // 标准响应处理 - 同时支持OpenAI和Gemini格式
      let content = '';
      let finish_reason = null;
      
      // 尝试OpenAI格式
      if (response.choices && response.choices[0]) {
        const choice = response.choices[0];
        content = choice.message?.content || '';
        finish_reason = choice.finish_reason;
      }
      // 尝试Gemini格式
      else if (response.candidates && response.candidates[0]) {
        const candidate = response.candidates[0];
        if (candidate.content?.parts) {
          // 提取所有text部分
          content = candidate.content.parts
            .filter(part => part.text)
            .map(part => part.text)
            .join('');
        }
        finish_reason = candidate.finishReason || 'stop';
      } else {
        throw new Error('AI响应格式错误: 没有找到choices或candidates');
      }

      return {
        content: content,
        finish_reason: finish_reason,
        usage: response.usage,
        model: model.name
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
      
      // 如果有图片或文件，额外增加token估算
      const fileTokens = (message.image_url || message.file) ? 100 : 0;
      
      return total + Math.ceil(chineseChars * 0.67 + otherChars * 0.25) + fileTokens;
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
