/**
 * 流式AI服务 - 增强PDF和多图支持版本
 * 基于业界最佳实践优化，支持PDF文档处理
 * 
 * v2.0 变更：
 *   - processMessagesForOpenRouter: 支持 msg.image_urls 多图数组
 *   - processMessagesStandard: 支持 msg.image_urls 多图数组
 * 
 * v3.0 变更：
 *   - callStreamAPI: 支持 options.enableThinking 参数
 *   - 针对 OpenRouter 端点，当 enableThinking 为 false 时添加 include_reasoning: false
 *   - 从源头控制是否让模型输出推理/思考过程，节省 token 和响应时间
 * 
 * 修复记录：
 *   - Gemini空回答问题 - 添加空内容检查和调试日志
 *   - API错误信息通过SSE发送给前端
 *   - 空内容时发送error事件而不是done事件
 *   - parseAPIError中JSON.stringify循环引用问题
 */

const axios = require('axios');
const AIModel = require('../models/AIModel');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

class AIStreamService {
  /** 解析Azure配置字符串 */
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
      if (model.api_key.split('|').length === 3) return true;
    }
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') return true;
    return false;
  }

  /** 判断是否为OpenRouter端点 */
  static isOpenRouterEndpoint(endpoint) {
    return endpoint && endpoint.includes('openrouter');
  }

  /** 判断文件是否为PDF */
  static isPDFFile(fileInfo) {
    if (!fileInfo) return false;
    if (fileInfo.mime_type === 'application/pdf') return true;
    if (fileInfo.url && fileInfo.url.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  /**
   * v2.0: 构建图片 content 块数组
   */
  static _buildImageContentBlocks(urls) {
    if (!urls || urls.length === 0) return [];
    return urls.map(url => ({ type: 'image_url', image_url: { url: url } }));
  }

  /**
   * 处理消息为OpenRouter格式 - v2.0: 支持多图
   */
  static processMessagesForOpenRouter(messages, model) {
    return messages.map(msg => {
      // PDF文件
      if (msg.file && this.isPDFFile(msg.file)) {
        logger.info('处理PDF消息为OpenRouter流式格式', { role: msg.role });
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            { type: 'file', file: { filename: 'document.pdf', file_data: msg.file.url } }
          ]
        };
      }

      // v2.0: 收集所有图片URL
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      if (imageUrls.length > 0 && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        contentBlocks.push(...this._buildImageContentBlocks(imageUrls));
        return { role: msg.role, content: contentBlocks };
      }

      return { role: msg.role, content: msg.content };
    });
  }

  /**
   * 处理消息为标准格式 - v2.0: 支持多图
   */
  static processMessagesStandard(messages, model) {
    return messages.map(msg => {
      // v2.0: 收集所有图片URL
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      if (imageUrls.length > 0 && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        contentBlocks.push(...this._buildImageContentBlocks(imageUrls));
        return { role: msg.role, content: contentBlocks };
      }

      // PDF文件在非OpenRouter下作为文本
      if (msg.file) {
        logger.warn('非OpenRouter端点不支持PDF直接处理（流式）', { provider: model.provider });
        return { role: msg.role, content: `${msg.content}\n\n[附件: ${msg.file.url}]` };
      }

      return msg;
    });
  }

  /** 发送SSE事件 */
  static sendSSE(res, event, data) {
    try {
      if (res.writableEnded || !res.headersSent) return false;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (error) {
      logger.error('发送SSE失败:', error);
      return false;
    }
  }

  /**
   * 安全地序列化对象，处理循环引用
   */
  static safeStringify(obj, maxLength = 500) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj === 'string') return obj.substring(0, maxLength);

    if (typeof obj === 'object') {
      if (obj.readable !== undefined || obj.writable !== undefined ||
          obj.pipe !== undefined || obj._readableState !== undefined) {
        return '[Stream Object]';
      }
      try {
        const seen = new WeakSet();
        const result = JSON.stringify(obj, (key, value) => {
          if (typeof value === 'function') return '[Function]';
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
          }
          return value;
        });
        return result.substring(0, maxLength);
      } catch (e) {
        return `[Object: ${obj.constructor?.name || 'Unknown'}]`;
      }
    }
    return String(obj).substring(0, maxLength);
  }

  /**
   * 解析API错误信息，提取用户友好的错误描述
   */
  static parseAPIError(error, model) {
    let userMessage = 'AI服务暂时不可用，请稍后重试';
    let technicalDetails = '';

    if (error.response) {
      const status = error.response.status;
      technicalDetails = AIStreamService.safeStringify(error.response.data, 500);

      switch (status) {
        case 400:
          if (technicalDetails.includes('file') || technicalDetails.includes('pdf') || technicalDetails.includes('document')) {
            userMessage = '文件处理失败：可能是文件过大、格式不支持或文件名包含特殊字符，请尝试重新上传';
          } else if (technicalDetails.includes('content') || technicalDetails.includes('message')) {
            userMessage = '消息内容格式错误，请检查输入内容';
          } else if (technicalDetails.includes('model')) {
            userMessage = '模型暂时不可用，请尝试切换其他模型';
          } else {
            userMessage = '请求格式错误，请检查输入内容或文件';
          }
          break;
        case 401: userMessage = 'API认证失败，请联系管理员检查配置'; break;
        case 402: userMessage = 'API额度不足，请联系管理员'; break;
        case 403: userMessage = '没有权限访问此模型'; break;
        case 404: userMessage = `模型 ${model.name} 不存在或已下线`; break;
        case 413: userMessage = '请求内容过大，请减少输入内容或文件大小'; break;
        case 429: userMessage = 'AI服务请求过于频繁，请稍后再试'; break;
        case 500: case 502: case 503: userMessage = 'AI服务暂时不可用，请稍后重试'; break;
        case 504: userMessage = 'AI服务响应超时，请稍后重试'; break;
        default: userMessage = `AI服务错误 (${status})，请稍后重试`;
      }
    } else if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
      userMessage = 'AI服务响应超时，请稍后重试';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      userMessage = 'AI服务连接失败，请检查网络';
    } else if (error.message) {
      userMessage = error.message.length > 100 ? error.message.substring(0, 100) + '...' : error.message;
    }

    return { userMessage, technicalDetails, statusCode: error.response?.status };
  }

  /**
   * 发送流式消息到AI模型
   */
  static async sendStreamMessage(res, modelName, messages, options = {}) {
    try {
      logger.info('开始流式AI服务', {
        model: modelName, messageCount: messages.length,
        enableThinking: options.enableThinking,
        hasPDFs: messages.some(m => m.file),
        hasMultiImages: messages.some(m => m.image_urls)
      });

      const model = await AIModel.findByName(modelName);
      if (!model) throw new Error(`AI模型 ${modelName} 未找到`);
      if (!model.stream_enabled) throw new Error(`AI模型 ${modelName} 不支持流式输出`);

      // 设置SSE响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });

      // 发送初始化数据
      if (options.userMessage || options.creditsInfo) {
        AIStreamService.sendSSE(res, 'init', {
          user_message: options.userMessage,
          ai_message_id: options.messageId,
          credits_info: options.creditsInfo
        });
      }

      if (AIStreamService.isAzureConfig(model)) {
        return await AIStreamService.callAzureStreamAPI(res, model, messages, options);
      } else {
        return await AIStreamService.callStreamAPI(res, model, messages, options);
      }
    } catch (error) {
      logger.error('流式AI服务失败:', error);
      const errorInfo = AIStreamService.parseAPIError(error, { name: modelName });
      if (!res.writableEnded) {
        AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, details: errorInfo.technicalDetails || '', code: errorInfo.statusCode || '' });
        res.end();
      }
      throw new ExternalServiceError(`流式AI服务失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 内部方法：处理流式数据的通用逻辑
   */
  static _handleStreamResponse(res, response, model, options, startTime) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    let chunkCount = 0;

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        try {
          chunkCount++;
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              if (!isDone) {
                isDone = true;
                logger.info('流式传输完成[DONE]', {
                  model: model.name, messageId: options.messageId,
                  chunkCount, contentLength: fullContent.length, totalTimeMs: Date.now() - startTime
                });
                AIStreamService._finishStream(res, fullContent, options);
                resolve({ content: fullContent });
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                AIStreamService.sendSSE(res, 'message', { delta, fullContent });
              }
              if (parsed.choices?.[0]?.finish_reason === 'stop' && !isDone) {
                isDone = true;
                logger.info('流式传输完成[stop]', {
                  model: model.name, messageId: options.messageId,
                  chunkCount, contentLength: fullContent.length, totalTimeMs: Date.now() - startTime
                });
                AIStreamService._finishStream(res, fullContent, options);
                resolve({ content: fullContent });
              }
            } catch (e) {
              logger.warn('解析流数据失败:', { error: e.message, rawData: data.substring(0, 200) });
            }
          }
        } catch (error) {
          logger.error('处理流数据失败:', error);
        }
      });

      response.data.on('end', () => {
        if (!isDone) {
          isDone = true;
          logger.info('流式传输结束[on end]', {
            model: model.name, messageId: options.messageId,
            chunkCount, contentLength: fullContent.length, totalTimeMs: Date.now() - startTime
          });
          AIStreamService._finishStream(res, fullContent, options);
          resolve({ content: fullContent });
        }
      });

      response.data.on('error', (error) => {
        logger.error('流式响应错误:', error);
        const errorInfo = AIStreamService.parseAPIError(error, model);
        if (!res.writableEnded) {
          AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, details: errorInfo.technicalDetails || '', code: errorInfo.statusCode });
          res.end();
        }
        reject(error);
      });

      res.on('close', () => {
        logger.info('客户端断开连接', {
          model: model.name, messageId: options.messageId,
          chunkCount, contentLength: fullContent.length, isDone, totalTimeMs: Date.now() - startTime
        });
        if (!isDone && options.onComplete) {
          if (fullContent && fullContent.length > 0) {
            options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
          } else {
            options.onComplete(null, 0);
          }
        }
      });
    });
  }

  /**
   * 内部方法：完成流式响应
   */
  static _finishStream(res, fullContent, options) {
    if (fullContent.length > 0) {
      AIStreamService.sendSSE(res, 'done', { content: fullContent, messageId: options.messageId });
    } else {
      logger.warn('流式传输完成但内容为空，发送错误事件', { messageId: options.messageId });
      AIStreamService.sendSSE(res, 'error', {
        error: 'AI返回内容为空，可能是文件解析失败或请求被拒绝，请重试或更换文件',
        code: 'EMPTY_RESPONSE'
      });
    }
    res.end();

    if (options.onComplete) {
      if (fullContent.length > 0) {
        options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
      } else {
        options.onComplete(null, 0);
      }
    }
  }

  /**
   * 调用标准OpenAI格式的流式API
   * v3.0: 支持 enableThinking 参数，针对 OpenRouter 控制推理输出
   */
  static async callStreamAPI(res, model, messages, options = {}) {
    const startTime = Date.now();

    try {
      const isOpenRouter = AIStreamService.isOpenRouterEndpoint(model.api_endpoint);

      let processedMessages;
      let plugins = undefined;

      if (isOpenRouter) {
        processedMessages = AIStreamService.processMessagesForOpenRouter(messages, model);
        if (messages.some(m => m.file)) {
          plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }];
        }
      } else {
        processedMessages = AIStreamService.processMessagesStandard(messages, model);
      }

      const requestData = {
        model: model.name,
        messages: processedMessages,
        temperature: options.temperature || 0.7,
        stream: true
      };
      if (plugins) requestData.plugins = plugins;

      /**
       * v3.0: 针对 OpenRouter 端点，根据 enableThinking 控制推理输出
       * - enableThinking 为 false（默认）：添加 include_reasoning: false，禁止模型输出思考过程
       * - enableThinking 为 true：不添加限制参数，允许模型自由思考
       * 
       * 注意：include_reasoning 是 OpenRouter 特有参数
       * 参考：https://openrouter.ai/docs/parameters
       */
      if (isOpenRouter && !options.enableThinking) {
        requestData.include_reasoning = false;
        logger.info('OpenRouter: 禁用推理输出（enableThinking=false）', { model: model.name });
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions')
        ? model.api_endpoint : `${model.api_endpoint}/chat/completions`;

      let headers = {
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      };
      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://ai.xingyuncl.com';
        headers['X-Title'] = 'AI Platform';
      }

      let response;
      try {
        response = await axios({ method: 'post', url: endpoint, data: requestData, headers, responseType: 'stream', timeout: 120000 });
      } catch (axiosError) {
        const errorInfo = AIStreamService.parseAPIError(axiosError, model);
        logger.error('API请求失败', { model: model.name, statusCode: errorInfo.statusCode, userMessage: errorInfo.userMessage });
        AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, code: errorInfo.statusCode, details: errorInfo.technicalDetails });
        res.end();
        if (options.onComplete) options.onComplete(null, 0);
        throw axiosError;
      }

      logger.info('开始接收流式响应', {
        model: model.name, isOpenRouter,
        enableThinking: options.enableThinking,
        responseTimeMs: Date.now() - startTime
      });

      return await AIStreamService._handleStreamResponse(res, response, model, options, startTime);
    } catch (error) {
      logger.error('流式API调用失败:', error);
      throw error;
    }
  }

  /**
   * 调用Azure流式API
   */
  static async callAzureStreamAPI(res, model, messages, options = {}) {
    const startTime = Date.now();

    try {
      const azureConfig = AIStreamService.parseAzureConfig(model.api_key);
      if (!azureConfig) throw new Error('Azure配置格式错误');

      const { apiKey, endpoint, apiVersion } = azureConfig;
      let deploymentName = model.name;
      if (model.name.includes('/')) deploymentName = model.name.split('/').pop();

      const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      const processedMessages = AIStreamService.processMessagesStandard(messages, model);
      const requestData = { messages: processedMessages, temperature: options.temperature || 0.7, stream: true };

      let response;
      try {
        response = await axios({
          method: 'post', url: azureUrl, data: requestData,
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          responseType: 'stream', timeout: 120000
        });
      } catch (axiosError) {
        const errorInfo = AIStreamService.parseAPIError(axiosError, model);
        logger.error('Azure API请求失败', { model: model.name, statusCode: errorInfo.statusCode });
        AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, code: errorInfo.statusCode });
        res.end();
        if (options.onComplete) options.onComplete(null, 0);
        throw axiosError;
      }

      logger.info('开始接收Azure流式响应');

      return await AIStreamService._handleStreamResponse(res, response, model, options, startTime);
    } catch (error) {
      logger.error('Azure流式API调用失败:', error);
      throw error;
    }
  }

  /** 估算Token数量 */
  static estimateTokens(content) {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }
}

module.exports = AIStreamService;
