/**
 * 流式AI服务 - 增强PDF支持版本
 * 基于业界最佳实践优化，支持PDF文档处理
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
      if (res.writableEnded || res.headersSent === false) {
        return false;
      }
      
      // 严格的SSE格式：event: type\ndata: json\n\n
      if (event) {
        res.write(`event: ${event}\n`);
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      
      // 立即刷新，不缓冲
      return true;
    } catch (error) {
      logger.error('发送SSE失败:', error);
      return false;
    }
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

      // 设置SSE响应头 - 关键配置
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Nginx禁用缓冲
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
      
      if (!res.writableEnded) {
        AIStreamService.sendSSE(res, 'error', { 
          error: error.message 
        });
        res.end();
      }
      
      throw new ExternalServiceError(`流式AI服务失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 调用标准OpenAI格式的流式API
   */
  static async callStreamAPI(res, model, messages, options = {}) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    
    try {
      // 检查是否为OpenRouter
      const isOpenRouter = AIStreamService.isOpenRouterEndpoint(model.api_endpoint);
      
      logger.info('准备流式请求', {
        model: model.name,
        isOpenRouter,
        hasPDFs: messages.some(m => m.file),
        hasImages: messages.some(m => m.image_url)
      });

      // 根据端点类型处理消息
      let processedMessages;
      let plugins = undefined;
      
      if (isOpenRouter) {
        processedMessages = AIStreamService.processMessagesForOpenRouter(messages, model);
        
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

      // 如果有plugins配置（OpenRouter PDF），添加到请求
      if (plugins) {
        requestData.plugins = plugins;
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions') ? 
        model.api_endpoint : 
        `${model.api_endpoint}/chat/completions`;

      // 设置请求头
      let headers = {
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      };
      
      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://ai.xingyuncl.com';
        headers['X-Title'] = 'AI Platform';
      }

      // 发起流式请求
      const response = await axios({
        method: 'post',
        url: endpoint,
        data: requestData,
        headers: headers,
        responseType: 'stream',
        timeout: 120000
      });

      logger.info('开始接收流式响应', {
        model: model.name,
        isOpenRouter,
        hadPDF: messages.some(m => m.file)
      });

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          try {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                
                // 检查流结束标记
                if (data === '[DONE]') {
                  if (!isDone) {
                    isDone = true;
                    AIStreamService.sendSSE(res, 'done', {
                      content: fullContent,
                      messageId: options.messageId
                    });
                    res.end();
                    
                    if (options.onComplete) {
                      options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
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
                    
                    // 立即发送每个片段，不缓冲
                    AIStreamService.sendSSE(res, 'message', {
                      delta: delta,
                      fullContent: fullContent
                    });
                  }
                  
                  // 检查finish_reason
                  if (parsed.choices?.[0]?.finish_reason === 'stop') {
                    if (!isDone) {
                      isDone = true;
                      AIStreamService.sendSSE(res, 'done', {
                        content: fullContent,
                        messageId: options.messageId
                      });
                      res.end();
                      
                      if (options.onComplete) {
                        options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
                      }
                      resolve({ content: fullContent });
                    }
                  }
                } catch (e) {
                  logger.warn('解析流数据失败:', e.message);
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
            AIStreamService.sendSSE(res, 'done', {
              content: fullContent,
              messageId: options.messageId
            });
            res.end();
            
            if (options.onComplete) {
              options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
            }
            resolve({ content: fullContent });
          }
        });

        response.data.on('error', (error) => {
          logger.error('流式响应错误:', error);
          if (!res.writableEnded) {
            AIStreamService.sendSSE(res, 'error', { 
              error: error.message 
            });
            res.end();
          }
          reject(error);
        });

        // 处理客户端断开
        res.on('close', () => {
          logger.info('客户端断开连接');
          if (!isDone && options.onComplete && fullContent) {
            options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
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
   */
  static async callAzureStreamAPI(res, model, messages, options = {}) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    
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

      // Azure不支持PDF，使用标准格式处理消息
      const processedMessages = AIStreamService.processMessagesStandard(messages, model);

      const requestData = {
        messages: processedMessages,
        temperature: options.temperature || 0.7,
        stream: true
      };

      const response = await axios({
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

      logger.info('开始接收Azure流式响应');

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          try {
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
                    AIStreamService.sendSSE(res, 'done', {
                      content: fullContent,
                      messageId: options.messageId
                    });
                    res.end();
                    
                    if (options.onComplete) {
                      options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
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
                    
                    // 立即发送，不缓冲
                    AIStreamService.sendSSE(res, 'message', {
                      delta: delta,
                      fullContent: fullContent
                    });
                  }
                  
                  if (parsed.choices?.[0]?.finish_reason === 'stop') {
                    if (!isDone) {
                      isDone = true;
                      AIStreamService.sendSSE(res, 'done', {
                        content: fullContent,
                        messageId: options.messageId
                      });
                      res.end();
                      
                      if (options.onComplete) {
                        options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
                      }
                      resolve({ content: fullContent });
                    }
                  }
                } catch (e) {
                  logger.warn('解析Azure数据失败:', e.message);
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
            AIStreamService.sendSSE(res, 'done', {
              content: fullContent,
              messageId: options.messageId
            });
            res.end();
            
            if (options.onComplete) {
              options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
            }
            resolve({ content: fullContent });
          }
        });

        response.data.on('error', (error) => {
          logger.error('Azure流式响应错误:', error);
          if (!res.writableEnded) {
            AIStreamService.sendSSE(res, 'error', { 
              error: error.message 
            });
            res.end();
          }
          reject(error);
        });

        res.on('close', () => {
          logger.info('客户端断开连接');
          if (!isDone && options.onComplete && fullContent) {
            options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
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
