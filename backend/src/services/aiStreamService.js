/**
 * 流式AI服务
 * 处理流式API调用和Server-Sent Events - 支持图片识别和Azure OpenAI
 * 修复：解决重复done事件和异常处理问题
 */

const axios = require('axios');
const AIModel = require('../models/AIModel');
const File = require('../models/File');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

class AIStreamService {
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
   * 发送流式消息到AI模型
   * @param {Object} res - Express响应对象，用于SSE
   * @param {string} modelName - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} options - 配置选项
   * @returns {Promise} 流式处理Promise
   */
  static async sendStreamMessage(res, modelName, messages, options = {}) {
    try {
      logger.info('开始流式AI服务调用', { 
        model: modelName, 
        messageCount: messages.length,
        customTemperature: options.temperature,
        hasImages: messages.some(m => m.image_url)
      });

      // 获取AI模型配置
      const model = await AIModel.findByName(modelName);
      if (!model) {
        throw new Error(`AI模型 ${modelName} 未找到或未启用`);
      }

      // 检查模型是否支持流式输出
      if (!model.stream_enabled) {
        throw new Error(`AI模型 ${modelName} 不支持流式输出`);
      }

      // 设置SSE响应头 - 关键配置
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // 禁用Nginx缓冲
        'Access-Control-Allow-Origin': '*'
      });

      // 立即flush确保头部发送
      res.flushHeaders();

      // 发送初始连接成功事件
      res.write('event: connected\ndata: {"status": "connected"}\n\n');

      // 如果有初始化数据，发送初始化事件
      if (options.userMessage || options.creditsInfo) {
        const initData = {
          user_message: options.userMessage,
          ai_message_id: options.messageId,
          credits_info: options.creditsInfo
        };
        res.write(`event: init\ndata: ${JSON.stringify(initData)}\n\n`);
      }

      // 根据模型类型调用不同的流式API
      if (AIStreamService.isAzureConfig(model)) {
        logger.info('检测到Azure配置，使用Azure流式API', {
          modelName: model.name,
          provider: model.provider,
          endpoint: model.api_endpoint
        });
        return await AIStreamService.callAzureStreamAPI(res, model, messages, options);
      } else {
        return await AIStreamService.callStreamAPI(res, model, messages, options);
      }
    } catch (error) {
      logger.error('流式AI服务调用失败:', error);
      
      // 发送错误事件
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
      
      throw new ExternalServiceError(`流式AI服务调用失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 调用Azure流式API
   */
  static async callAzureStreamAPI(res, model, messages, options = {}) {
    let fullContent = '';
    let tokenCount = 0;
    const startTime = Date.now();
    let buffer = '';
    let messageCount = 0;
    let isDoneEventSent = false;
    let streamTimeout = null;
    let lastDataTime = Date.now();
    
    try {
      // 解析Azure配置
      const azureConfig = AIStreamService.parseAzureConfig(model.api_key);
      if (!azureConfig) {
        throw new Error('Azure配置格式错误，应为: api_key|endpoint|api_version');
      }

      const { apiKey, endpoint, apiVersion } = azureConfig;

      // 从model.name提取deployment名称
      let deploymentName = model.name;
      if (model.name.includes('/')) {
        const parts = model.name.split('/');
        deploymentName = parts[parts.length - 1];
      }

      // 构造Azure特定的URL
      const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      logger.info('调用Azure流式API', {
        model: model.name,
        deployment: deploymentName,
        endpoint: baseUrl,
        apiVersion: apiVersion,
        url: azureUrl,
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

      // 处理包含图片的消息
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
        stream: true
      };

      logger.info('Azure请求数据', {
        url: azureUrl,
        headers: {
          'api-key': '***' + apiKey.slice(-4), // 只显示最后4位
          'Content-Type': 'application/json'
        },
        requestData: {
          ...requestData,
          messages: requestData.messages.map(m => ({
            role: m.role,
            contentLength: typeof m.content === 'string' ? m.content.length : 'complex'
          }))
        }
      });

      // 发起流式请求 - 使用api-key头
      const response = await axios({
        method: 'post',
        url: azureUrl,
        data: requestData,
        headers: {
          'api-key': apiKey,  // Azure使用api-key头
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        responseType: 'stream',
        timeout: 180000
      });

      logger.info('Azure流式响应开始接收');

      // 完成流式响应的函数
      const completeStream = (reason = 'normal') => {
        if (isDoneEventSent) {
          logger.debug('Done事件已发送，跳过重复发送', { reason });
          return;
        }
        
        isDoneEventSent = true;
        
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
        
        logger.info('Azure流式传输完成', {
          reason,
          totalMessages: messageCount,
          contentLength: fullContent.length,
          duration: Date.now() - startTime
        });
        
        if (!res.writableEnded) {
          const completionData = {
            content: fullContent,
            tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent),
            duration: Date.now() - startTime,
            messageId: options.messageId,
            conversationId: options.conversationId,
            reason: reason
          };
          
          res.write(`event: done\ndata: ${JSON.stringify(completionData)}\n\n`);
          res.end();
        }
        
        if (options.onComplete) {
          options.onComplete(fullContent, tokenCount || AIStreamService.estimateStreamTokens(fullContent));
        }
      };

      const resetTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
        }
        streamTimeout = setTimeout(() => {
          const timeSinceLastData = Date.now() - lastDataTime;
          logger.warn('Azure流式响应超时', {
            timeSinceLastData,
            contentReceived: fullContent.length,
            messageCount
          });
          completeStream('timeout');
        }, 30000);
      };

      return new Promise((resolve, reject) => {
        resetTimeout();

        response.data.on('data', (chunk) => {
          try {
            lastDataTime = Date.now();
            resetTimeout();
            
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === '') continue;
              
              if (trimmedLine.startsWith('data: ')) {
                const jsonStr = trimmedLine.slice(6);
                
                if (jsonStr === '[DONE]') {
                  completeStream('done_signal');
                  resolve({
                    content: fullContent,
                    tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
                  });
                  return;
                }
                
                try {
                  const data = JSON.parse(jsonStr);
                  
                  if (data.error) {
                    logger.error('Azure API返回错误', { error: data.error });
                    throw new Error(data.error.message || 'Azure API错误');
                  }
                  
                  const deltaContent = data.choices?.[0]?.delta?.content;
                  
                  if (deltaContent && deltaContent !== '') {
                    messageCount++;
                    fullContent += deltaContent;
                    tokenCount += AIStreamService.estimateStreamTokens(deltaContent);
                    
                    const messageData = {
                      content: deltaContent,
                      fullContent: fullContent
                    };
                    
                    if (!res.writableEnded) {
                      res.write(`event: message\ndata: ${JSON.stringify(messageData)}\n\n`);
                    }
                    
                    if (messageCount % 10 === 0) {
                      logger.debug('Azure流式片段进度', {
                        messages: messageCount,
                        contentLength: fullContent.length
                      });
                    }
                  }
                  
                  const finishReason = data.choices?.[0]?.finish_reason;
                  if (finishReason) {
                    logger.info('Azure流式响应结束', { finishReason });
                    if (finishReason === 'stop' || finishReason === 'length') {
                      completeStream(`finish_${finishReason}`);
                      resolve({
                        content: fullContent,
                        tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
                      });
                      return;
                    }
                  }
                } catch (parseError) {
                  logger.warn('解析Azure流式数据失败:', {
                    error: parseError.message,
                    data: jsonStr.substring(0, 100)
                  });
                }
              }
            }
          } catch (error) {
            logger.error('处理Azure流式数据块失败:', error);
          }
        });

        response.data.on('error', (error) => {
          logger.error('Azure流式响应错误:', {
            error: error.message,
            contentReceived: fullContent.length
          });
          
          if (fullContent.length > 0) {
            completeStream('error_with_content');
            resolve({
              content: fullContent,
              tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
            });
          } else {
            if (!res.writableEnded) {
              res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
              res.end();
            }
            reject(error);
          }
        });

        response.data.on('end', () => {
          logger.info('Azure流式响应接收结束', {
            contentLength: fullContent.length,
            isDoneEventSent
          });
          
          if (buffer.trim()) {
            logger.warn('存在未处理的Azure流式数据:', buffer.substring(0, 100));
          }
          
          if (!isDoneEventSent) {
            completeStream('stream_end');
            resolve({
              content: fullContent,
              tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
            });
          }
        });

        res.on('close', () => {
          logger.info('客户端连接关闭', {
            contentReceived: fullContent.length,
            isDoneEventSent
          });
          
          if (fullContent.length > 0 && !isDoneEventSent) {
            completeStream('client_disconnect');
          }
          
          if (streamTimeout) {
            clearTimeout(streamTimeout);
          }
        });
      });

    } catch (error) {
      logger.error('Azure流式API调用失败:', {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        contentReceived: fullContent.length
      });
      
      // 如果是400错误，可能是deployment名称或API版本问题
      if (error.response?.status === 400) {
        logger.error('Azure API 400错误详情:', {
          data: error.response.data,
          headers: error.response.headers,
          config: {
            url: error.config?.url,
            method: error.config?.method
          }
        });
      }
      
      if (fullContent.length > 0 && !isDoneEventSent && options.onComplete) {
        logger.info('尝试保存部分接收的内容');
        options.onComplete(fullContent, tokenCount || AIStreamService.estimateStreamTokens(fullContent));
      }
      
      throw error;
    }
  }

  /**
   * 调用模型流式API（标准OpenAI格式）
   */
  static async callStreamAPI(res, model, messages, options = {}) {
    let fullContent = '';
    let tokenCount = 0;
    const startTime = Date.now();
    let buffer = ''; // 用于处理不完整的数据块
    let messageCount = 0;
    let isDoneEventSent = false; // 防止重复发送done事件
    let streamTimeout = null; // 超时控制
    let lastDataTime = Date.now(); // 最后收到数据的时间
    
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

      // 使用会话级temperature
      const finalTemperature = options.temperature !== undefined ? 
        parseFloat(options.temperature) : 
        (requestConfig.temperature || 0.7);

      logger.info('调用流式AI模型API', { 
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
            // Claude格式（如果需要）
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

      // 构造请求数据
      const requestData = {
        model: model.name,
        messages: processedMessages,
        temperature: finalTemperature,
        top_p: requestConfig.top_p || 1,
        presence_penalty: requestConfig.presence_penalty || 0,
        frequency_penalty: requestConfig.frequency_penalty || 0,
        stream: true // 开启流式模式
      };

      const endpoint = model.api_endpoint.endsWith('/chat/completions') ? 
        model.api_endpoint : 
        `${model.api_endpoint}/chat/completions`;

      // 发起流式请求
      const response = await axios({
        method: 'post',
        url: endpoint,
        data: requestData,
        headers: {
          'Authorization': `Bearer ${model.api_key}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        responseType: 'stream',
        timeout: 180000 // 3分钟超时，图片处理可能需要更长时间
      });

      logger.info('流式响应开始接收');

      // 完成流式响应的函数
      const completeStream = (reason = 'normal') => {
        if (isDoneEventSent) {
          logger.debug('Done事件已发送，跳过重复发送', { reason });
          return;
        }
        
        isDoneEventSent = true;
        
        // 清除超时定时器
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
        
        logger.info('流式传输完成', {
          reason,
          totalMessages: messageCount,
          contentLength: fullContent.length,
          duration: Date.now() - startTime
        });
        
        // 发送完成事件
        if (!res.writableEnded) {
          const completionData = {
            content: fullContent,
            tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent),
            duration: Date.now() - startTime,
            messageId: options.messageId,
            conversationId: options.conversationId,
            reason: reason
          };
          
          res.write(`event: done\ndata: ${JSON.stringify(completionData)}\n\n`);
          res.end();
        }
        
        // 调用完成回调（用于保存消息）
        if (options.onComplete) {
          options.onComplete(fullContent, tokenCount || AIStreamService.estimateStreamTokens(fullContent));
        }
      };

      // 设置数据接收超时（30秒无数据则超时）
      const resetTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
        }
        streamTimeout = setTimeout(() => {
          const timeSinceLastData = Date.now() - lastDataTime;
          logger.warn('流式响应超时', {
            timeSinceLastData,
            contentReceived: fullContent.length,
            messageCount
          });
          completeStream('timeout');
        }, 30000); // 30秒无数据超时
      };

      // 返回Promise以便等待流式完成
      return new Promise((resolve, reject) => {
        // 初始化超时
        resetTimeout();

        // 处理流式响应
        response.data.on('data', (chunk) => {
          try {
            // 更新最后数据时间并重置超时
            lastDataTime = Date.now();
            resetTimeout();
            
            // 将chunk转换为字符串并添加到buffer
            buffer += chunk.toString();
            
            // 按行分割，处理完整的行
            const lines = buffer.split('\n');
            
            // 保留最后一个可能不完整的行
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === '') continue;
              
              // 处理SSE格式: data: {...}
              if (trimmedLine.startsWith('data: ')) {
                const jsonStr = trimmedLine.slice(6);
                
                // 检查是否是结束标记
                if (jsonStr === '[DONE]') {
                  completeStream('done_signal');
                  resolve({
                    content: fullContent,
                    tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
                  });
                  return;
                }
                
                try {
                  const data = JSON.parse(jsonStr);
                  
                  // 检查是否有错误
                  if (data.error) {
                    logger.error('API返回错误', { error: data.error });
                    throw new Error(data.error.message || 'API错误');
                  }
                  
                  const deltaContent = data.choices?.[0]?.delta?.content;
                  
                  if (deltaContent && deltaContent !== '') {
                    messageCount++;
                    fullContent += deltaContent;
                    tokenCount += AIStreamService.estimateStreamTokens(deltaContent);
                    
                    // 发送内容片段 - 确保格式正确
                    const messageData = {
                      content: deltaContent,
                      fullContent: fullContent
                    };
                    
                    if (!res.writableEnded) {
                      res.write(`event: message\ndata: ${JSON.stringify(messageData)}\n\n`);
                    }
                    
                    // 每10个片段记录一次日志
                    if (messageCount % 10 === 0) {
                      logger.debug('流式片段进度', {
                        messages: messageCount,
                        contentLength: fullContent.length
                      });
                    }
                  }
                  
                  // 检查finish_reason
                  const finishReason = data.choices?.[0]?.finish_reason;
                  if (finishReason) {
                    logger.info('流式响应结束', { finishReason });
                    if (finishReason === 'stop' || finishReason === 'length') {
                      completeStream(`finish_${finishReason}`);
                      resolve({
                        content: fullContent,
                        tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
                      });
                      return;
                    }
                  }
                } catch (parseError) {
                  logger.warn('解析流式数据失败:', {
                    error: parseError.message,
                    data: jsonStr.substring(0, 100)
                  });
                }
              }
            }
          } catch (error) {
            logger.error('处理流式数据块失败:', error);
            // 不立即结束，继续尝试处理后续数据
          }
        });

        response.data.on('error', (error) => {
          logger.error('流式响应错误:', {
            error: error.message,
            contentReceived: fullContent.length
          });
          
          // 如果已经接收到部分内容，保存它
          if (fullContent.length > 0) {
            completeStream('error_with_content');
            resolve({
              content: fullContent,
              tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
            });
          } else {
            if (!res.writableEnded) {
              res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
              res.end();
            }
            reject(error);
          }
        });

        response.data.on('end', () => {
          logger.info('流式响应接收结束', {
            contentLength: fullContent.length,
            isDoneEventSent
          });
          
          // 如果还有未处理的buffer数据，尝试处理
          if (buffer.trim()) {
            logger.warn('存在未处理的流式数据:', buffer.substring(0, 100));
          }
          
          // 确保完成事件被发送（如果还没发送）
          if (!isDoneEventSent) {
            completeStream('stream_end');
            resolve({
              content: fullContent,
              tokens: tokenCount || AIStreamService.estimateStreamTokens(fullContent)
            });
          }
        });

        // 处理连接关闭
        res.on('close', () => {
          logger.info('客户端连接关闭', {
            contentReceived: fullContent.length,
            isDoneEventSent
          });
          
          // 如果客户端断开连接但已经有内容，保存它
          if (fullContent.length > 0 && !isDoneEventSent) {
            completeStream('client_disconnect');
          }
          
          // 清理超时
          if (streamTimeout) {
            clearTimeout(streamTimeout);
          }
        });
      });

    } catch (error) {
      logger.error('流式模型API调用失败:', {
        error: error.message,
        response: error.response?.data,
        contentReceived: fullContent.length
      });
      
      // 如果已经接收到部分内容，尝试保存
      if (fullContent.length > 0 && !isDoneEventSent && options.onComplete) {
        logger.info('尝试保存部分接收的内容');
        options.onComplete(fullContent, tokenCount || AIStreamService.estimateStreamTokens(fullContent));
      }
      
      throw error;
    }
  }

  /**
   * 估算流式内容的Token数量
   */
  static estimateStreamTokens(content) {
    if (!content || typeof content !== 'string') {
      return 0;
    }
    
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }
}

module.exports = AIStreamService;
