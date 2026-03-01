/**
 * 流式AI服务 - 增强PDF支持版本
 * 基于业界最佳实践优化，支持PDF文档处理
 * 修复：Gemini空回答问题 - 添加空内容检查和调试日志
 * 修复：API错误信息通过SSE发送给前端
 * 修复：空内容时发送error事件而不是done事件
 * 修复：parseAPIError中JSON.stringify循环引用问题
 */

const axios = require('axios');
const AIModel = require('../models/AIModel');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

class AIStreamService {
  /**
   * 解析Azure配置字符串
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
    if (model.provider === 'azure' || model.provider === 'azure-openai') {
      return true;
    }
    
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|');
      if (parts.length === 3) {
        return true;
      }
    }
    
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
   * 判断文件是否为PDF
   */
  static isPDFFile(fileInfo) {
    if (!fileInfo) return false;
    
    // 通过MIME类型判断
    if (fileInfo.mime_type === 'application/pdf') {
      return true;
    }
    
    // 通过文件名判断（作为备选）
    if (fileInfo.url && fileInfo.url.toLowerCase().endsWith('.pdf')) {
      return true;
    }
    
    return false;
  }

  /**
   * 处理消息为OpenRouter格式 - 支持PDF
   */
  static processMessagesForOpenRouter(messages, model) {
    return messages.map(msg => {
      // 如果消息包含PDF文件
      if (msg.file && this.isPDFFile(msg.file)) {
        logger.info('处理PDF消息为OpenRouter流式格式', {
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
      if (msg.image_url && model.image_upload_enabled) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            { type: 'image_url', image_url: { url: msg.image_url } }
          ]
        };
      }
      
      // 对于PDF文件，在非OpenRouter的情况下，作为文本处理
      if (msg.file) {
        logger.warn('非OpenRouter端点不支持PDF直接处理（流式）', {
          provider: model.provider,
          endpoint: model.api_endpoint
        });
        // 在content中添加文件URL说明
        return {
          role: msg.role,
          content: `${msg.content}\n\n[附件: ${msg.file.url}]`
        };
      }
      
      return msg;
    });
  }

  /**
   * 发送SSE事件 - 严格遵循SSE规范
   */
  static sendSSE(res, event, data) {
    try {
      // 如果连接已关闭或头部未发送，则不发送
      if (res.writableEnded || !res.headersSent) {
        return false;
      }
      
      // 严格的SSE格式：event: type\ndata: json\n\n
      if (event) {
        res.write(`event: ${event}\n`);
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      
      return true;
    } catch (error) {
      logger.error('发送SSE失败:', error);
      return false;
    }
  }

  /**
   * 安全地序列化对象，处理循环引用
   * @param {*} obj - 要序列化的对象
   * @param {number} maxLength - 最大字符串长度
   * @returns {string} - 序列化后的字符串
   */
  static safeStringify(obj, maxLength = 500) {
    if (obj === null || obj === undefined) {
      return '';
    }
    
    if (typeof obj === 'string') {
      return obj.substring(0, maxLength);
    }
    
    // 检查是否是流对象或包含循环引用的对象
    if (typeof obj === 'object') {
      // 检查是否是 stream 或有特殊属性
      if (obj.readable !== undefined || obj.writable !== undefined || 
          obj.pipe !== undefined || obj._readableState !== undefined) {
        return '[Stream Object]';
      }
      
      try {
        // 尝试JSON序列化
        const seen = new WeakSet();
        const result = JSON.stringify(obj, (key, value) => {
          // 跳过函数
          if (typeof value === 'function') {
            return '[Function]';
          }
          // 检测循环引用
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          return value;
        });
        return result.substring(0, maxLength);
      } catch (e) {
        // 如果仍然失败，返回类型信息
        return `[Object: ${obj.constructor?.name || 'Unknown'}]`;
      }
    }
    
    return String(obj).substring(0, maxLength);
  }

  /**
   * 解析API错误信息，提取用户友好的错误描述
   * 修复：安全处理循环引用对象
   */
  static parseAPIError(error, model) {
    let userMessage = 'AI服务暂时不可用，请稍后重试';
    let technicalDetails = '';
    
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      // 🔥 修复：安全地提取技术细节，处理循环引用
      technicalDetails = AIStreamService.safeStringify(data, 500);
      
      // 根据状态码和错误内容生成用户友好的提示
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
        case 401:
          userMessage = 'API认证失败，请联系管理员检查配置';
          break;
        case 402:
          userMessage = 'API额度不足，请联系管理员';
          break;
        case 403:
          userMessage = '没有权限访问此模型';
          break;
        case 404:
          userMessage = `模型 ${model.name} 不存在或已下线`;
          break;
        case 413:
          userMessage = '请求内容过大，请减少输入内容或文件大小';
          break;
        case 429:
          userMessage = 'AI服务请求过于频繁，请稍后再试';
          break;
        case 500:
        case 502:
        case 503:
          userMessage = 'AI服务暂时不可用，请稍后重试';
          break;
        case 504:
          userMessage = 'AI服务响应超时，请稍后重试';
          break;
        default:
          userMessage = `AI服务错误 (${status})，请稍后重试`;
      }
    } else if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
      userMessage = 'AI服务响应超时，请稍后重试';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      userMessage = 'AI服务连接失败，请检查网络';
    } else if (error.message) {
      // 其他错误，使用错误消息
      userMessage = error.message.length > 100 ? error.message.substring(0, 100) + '...' : error.message;
    }
    
    return {
      userMessage,
      technicalDetails,
      statusCode: error.response?.status
    };
  }

  /**
   * 发送流式消息到AI模型
   */
  static async sendStreamMessage(res, modelName, messages, options = {}) {
    try {
      logger.info('开始流式AI服务', { 
        model: modelName, 
        messageCount: messages.length,
        hasPDFs: messages.some(m => m.file)
      });

      const model = await AIModel.findByName(modelName);
      if (!model) {
        throw new Error(`AI模型 ${modelName} 未找到`);
      }

      if (!model.stream_enabled) {
        throw new Error(`AI模型 ${modelName} 不支持流式输出`);
      }

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

      // 根据模型类型调用API
      if (AIStreamService.isAzureConfig(model)) {
        return await AIStreamService.callAzureStreamAPI(res, model, messages, options);
      } else {
        return await AIStreamService.callStreamAPI(res, model, messages, options);
      }
    } catch (error) {
      logger.error('流式AI服务失败:', error);
      
      // 🔥 修复：安全地解析错误
      const errorInfo = AIStreamService.parseAPIError(error, { name: modelName });
      
      if (!res.writableEnded) {
        AIStreamService.sendSSE(res, 'error', { 
          error: errorInfo.userMessage,
          details: errorInfo.technicalDetails || '',
          code: errorInfo.statusCode || ''
        });
        res.end();
      }
      
      throw new ExternalServiceError(`流式AI服务失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 调用标准OpenAI格式的流式API
   * 修复：空内容时发送error事件而不是done事件
   */
  static async callStreamAPI(res, model, messages, options = {}) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    let chunkCount = 0;
    let startTime = Date.now();
    
    try {
      const isOpenRouter = AIStreamService.isOpenRouterEndpoint(model.api_endpoint);
      
      logger.info('准备流式请求', {
        model: model.name,
        isOpenRouter,
        hasPDFs: messages.some(m => m.file),
        hasImages: messages.some(m => m.image_url)
      });

      let processedMessages;
      let plugins = undefined;
      
      if (isOpenRouter) {
        processedMessages = AIStreamService.processMessagesForOpenRouter(messages, model);
        
        if (messages.some(m => m.file)) {
          plugins = [
            {
              id: 'file-parser',
              pdf: {
                engine: 'pdf-text'
              }
            }
          ];
          logger.info('为PDF添加OpenRouter流式插件配置', { engine: 'pdf-text' });
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

      if (plugins) {
        requestData.plugins = plugins;
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions') ? 
        model.api_endpoint : 
        `${model.api_endpoint}/chat/completions`;

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
        response = await axios({
          method: 'post',
          url: endpoint,
          data: requestData,
          headers: headers,
          responseType: 'stream',
          timeout: 120000
        });
      } catch (axiosError) {
        // 🔥 修复：安全地解析错误
        const errorInfo = AIStreamService.parseAPIError(axiosError, model);
        
        logger.error('API请求失败', {
          model: model.name,
          statusCode: errorInfo.statusCode,
          userMessage: errorInfo.userMessage,
          technicalDetails: errorInfo.technicalDetails
        });
        
        AIStreamService.sendSSE(res, 'error', {
          error: errorInfo.userMessage,
          code: errorInfo.statusCode,
          details: errorInfo.technicalDetails
        });
        res.end();
        
        if (options.onComplete) {
          options.onComplete(null, 0);
        }
        
        throw axiosError;
      }

      const responseTime = Date.now() - startTime;
      logger.info('开始接收流式响应', {
        model: model.name,
        isOpenRouter,
        hadPDF: messages.some(m => m.file),
        responseTimeMs: responseTime
      });

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          try {
            chunkCount++;
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                
                if (data === '[DONE]') {
                  if (!isDone) {
                    isDone = true;
                    
                    logger.info('流式传输完成[DONE]', {
                      model: model.name,
                      messageId: options.messageId,
                      chunkCount,
                      contentLength: fullContent.length,
                      hasContent: fullContent.length > 0,
                      totalTimeMs: Date.now() - startTime
                    });
                    
                    // 如果内容为空，发送error事件而不是done事件
                    if (fullContent.length > 0) {
                      AIStreamService.sendSSE(res, 'done', {
                        content: fullContent,
                        messageId: options.messageId
                      });
                    } else {
                      logger.warn('流式传输完成但内容为空，发送错误事件', {
                        model: model.name,
                        messageId: options.messageId,
                        chunkCount
                      });
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
                    resolve({ content: fullContent });
                  }
                  return;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  
                  if (delta) {
                    fullContent += delta;
                    AIStreamService.sendSSE(res, 'message', {
                      delta: delta,
                      fullContent: fullContent
                    });
                  }
                  
                  if (parsed.choices?.[0]?.finish_reason === 'stop') {
                    if (!isDone) {
                      isDone = true;
                      
                      logger.info('流式传输完成[finish_reason=stop]', {
                        model: model.name,
                        messageId: options.messageId,
                        chunkCount,
                        contentLength: fullContent.length,
                        hasContent: fullContent.length > 0,
                        totalTimeMs: Date.now() - startTime
                      });
                      
                      // 如果内容为空，发送error事件
                      if (fullContent.length > 0) {
                        AIStreamService.sendSSE(res, 'done', {
                          content: fullContent,
                          messageId: options.messageId
                        });
                      } else {
                        logger.warn('流式传输完成但内容为空，发送错误事件', {
                          model: model.name,
                          messageId: options.messageId,
                          chunkCount
                        });
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
                      resolve({ content: fullContent });
                    }
                  }
                } catch (e) {
                  logger.warn('解析流数据失败:', {
                    error: e.message,
                    rawData: data.substring(0, 200),
                    model: model.name
                  });
                }
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
              model: model.name,
              messageId: options.messageId,
              chunkCount,
              contentLength: fullContent.length,
              hasContent: fullContent.length > 0,
              totalTimeMs: Date.now() - startTime
            });
            
            // 如果内容为空，发送error事件
            if (fullContent.length > 0) {
              AIStreamService.sendSSE(res, 'done', {
                content: fullContent,
                messageId: options.messageId
              });
            } else {
              logger.warn('流式传输结束但内容为空，发送错误事件', {
                model: model.name,
                messageId: options.messageId,
                chunkCount
              });
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
            resolve({ content: fullContent });
          }
        });

        response.data.on('error', (error) => {
          logger.error('流式响应错误:', error);
          
          // 🔥 修复：安全地解析错误
          const errorInfo = AIStreamService.parseAPIError(error, model);
          
          if (!res.writableEnded) {
            AIStreamService.sendSSE(res, 'error', { 
              error: errorInfo.userMessage,
              details: errorInfo.technicalDetails || '',
              code: errorInfo.statusCode
            });
            res.end();
          }
          reject(error);
        });

        res.on('close', () => {
          logger.info('客户端断开连接', {
            model: model.name,
            messageId: options.messageId,
            chunkCount,
            contentLength: fullContent.length,
            hasContent: fullContent.length > 0,
            isDone,
            totalTimeMs: Date.now() - startTime
          });
          
          if (!isDone && options.onComplete && fullContent && fullContent.length > 0) {
            options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
          } else if (!isDone && options.onComplete && (!fullContent || fullContent.length === 0)) {
            logger.warn('客户端断开连接且内容为空，标记为失败', {
              model: model.name,
              messageId: options.messageId
            });
            options.onComplete(null, 0);
          }
        });
      });
    } catch (error) {
      logger.error('流式API调用失败:', error);
      throw error;
    }
  }

  /**
   * 调用Azure流式API
   * 修复：空内容时发送error事件而不是done事件
   */
  static async callAzureStreamAPI(res, model, messages, options = {}) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    let chunkCount = 0;
    let startTime = Date.now();
    
    try {
      const azureConfig = AIStreamService.parseAzureConfig(model.api_key);
      if (!azureConfig) {
        throw new Error('Azure配置格式错误');
      }

      const { apiKey, endpoint, apiVersion } = azureConfig;
      let deploymentName = model.name;
      if (model.name.includes('/')) {
        const parts = model.name.split('/');
        deploymentName = parts[parts.length - 1];
      }

      const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      const processedMessages = AIStreamService.processMessagesStandard(messages, model);

      const requestData = {
        messages: processedMessages,
        temperature: options.temperature || 0.7,
        stream: true
      };

      let response;
      try {
        response = await axios({
          method: 'post',
          url: azureUrl,
          data: requestData,
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          responseType: 'stream',
          timeout: 120000
        });
      } catch (axiosError) {
        // 🔥 修复：安全地解析错误
        const errorInfo = AIStreamService.parseAPIError(axiosError, model);
        
        logger.error('Azure API请求失败', {
          model: model.name,
          statusCode: errorInfo.statusCode,
          userMessage: errorInfo.userMessage
        });
        
        AIStreamService.sendSSE(res, 'error', {
          error: errorInfo.userMessage,
          code: errorInfo.statusCode
        });
        res.end();
        
        if (options.onComplete) {
          options.onComplete(null, 0);
        }
        
        throw axiosError;
      }

      logger.info('开始接收Azure流式响应');

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          try {
            chunkCount++;
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                
                if (data === '[DONE]') {
                  if (!isDone) {
                    isDone = true;
                    
                    logger.info('Azure流式传输完成[DONE]', {
                      messageId: options.messageId,
                      chunkCount,
                      contentLength: fullContent.length,
                      hasContent: fullContent.length > 0
                    });
                    
                    // 如果内容为空，发送error事件
                    if (fullContent.length > 0) {
                      AIStreamService.sendSSE(res, 'done', {
                        content: fullContent,
                        messageId: options.messageId
                      });
                    } else {
                      logger.warn('Azure流式传输完成但内容为空，发送错误事件');
                      AIStreamService.sendSSE(res, 'error', {
                        error: 'AI返回内容为空，请重试',
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
                    resolve({ content: fullContent });
                  }
                  return;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  
                  if (delta) {
                    fullContent += delta;
                    AIStreamService.sendSSE(res, 'message', {
                      delta: delta,
                      fullContent: fullContent
                    });
                  }
                  
                  if (parsed.choices?.[0]?.finish_reason === 'stop') {
                    if (!isDone) {
                      isDone = true;
                      
                      logger.info('Azure流式传输完成[finish_reason=stop]', {
                        messageId: options.messageId,
                        chunkCount,
                        contentLength: fullContent.length,
                        hasContent: fullContent.length > 0
                      });
                      
                      // 如果内容为空，发送error事件
                      if (fullContent.length > 0) {
                        AIStreamService.sendSSE(res, 'done', {
                          content: fullContent,
                          messageId: options.messageId
                        });
                      } else {
                        logger.warn('Azure流式传输完成但内容为空，发送错误事件');
                        AIStreamService.sendSSE(res, 'error', {
                          error: 'AI返回内容为空，请重试',
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
                      resolve({ content: fullContent });
                    }
                  }
                } catch (e) {
                  logger.warn('解析Azure数据失败:', {
                    error: e.message,
                    rawData: data.substring(0, 200)
                  });
                }
              }
            }
          } catch (error) {
            logger.error('处理Azure数据失败:', error);
          }
        });

        response.data.on('end', () => {
          if (!isDone) {
            isDone = true;
            
            logger.info('Azure流式传输结束[on end]', {
              messageId: options.messageId,
              chunkCount,
              contentLength: fullContent.length,
              hasContent: fullContent.length > 0
            });
            
            // 如果内容为空，发送error事件
            if (fullContent.length > 0) {
              AIStreamService.sendSSE(res, 'done', {
                content: fullContent,
                messageId: options.messageId
              });
            } else {
              logger.warn('Azure流式传输结束但内容为空，发送错误事件');
              AIStreamService.sendSSE(res, 'error', {
                error: 'AI返回内容为空，请重试',
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
            resolve({ content: fullContent });
          }
        });

        response.data.on('error', (error) => {
          logger.error('Azure流式响应错误:', error);
          
          // 🔥 修复：安全地解析错误
          const errorInfo = AIStreamService.parseAPIError(error, model);
          
          if (!res.writableEnded) {
            AIStreamService.sendSSE(res, 'error', { 
              error: errorInfo.userMessage,
              details: errorInfo.technicalDetails || '',
              code: errorInfo.statusCode
            });
            res.end();
          }
          reject(error);
        });

        res.on('close', () => {
          logger.info('客户端断开连接(Azure)', {
            messageId: options.messageId,
            chunkCount,
            contentLength: fullContent.length,
            hasContent: fullContent.length > 0,
            isDone
          });
          
          if (!isDone && options.onComplete && fullContent && fullContent.length > 0) {
            options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
          } else if (!isDone && options.onComplete && (!fullContent || fullContent.length === 0)) {
            logger.warn('Azure客户端断开连接且内容为空，标记为失败');
            options.onComplete(null, 0);
          }
        });
      });
    } catch (error) {
      logger.error('Azure流式API调用失败:', error);
      throw error;
    }
  }

  /**
   * 估算Token数量
   */
  static estimateTokens(content) {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }
}

module.exports = AIStreamService;
