/**
 * AI调用辅助工具类
 * v1.0 - 从LLMNode和ClassifierNode中提取的公共AI调用方法
 * v1.1 - 新增callAIStream流式调用方法，支持Agent外部API流式输出
 * 
 * 统一管理：
 * - 标准OpenAI格式API调用（非流式）
 * - Azure OpenAI API调用（非流式）
 * - v1.1: 标准OpenAI格式流式调用（SSE）
 * - v1.1: Azure OpenAI格式流式调用（SSE）
 * - Azure配置检测和解析
 * - Token估算
 */

const axios = require('axios');
const logger = require('../../../utils/logger');

class AICallHelper {
  /**
   * 调用AI模型（非流式）- 统一入口
   * 自动检测Azure/标准API并路由到对应方法
   */
  static async callAI(model, messages, options = {}) {
    try {
      if (AICallHelper.isAzureConfig(model)) {
        return await AICallHelper.callAzureAPI(model, messages, options);
      } else {
        return await AICallHelper.callStandardAPI(model, messages, options);
      }
    } catch (error) {
      logger.error('AI调用失败:', {
        modelName: model?.name, provider: model?.provider, error: error.message
      });
      throw error;
    }
  }

  /**
   * v1.1: 调用AI模型（流式）- 将SSE事件直接写入res
   * 用于Agent外部API的流式输出端点
   * 
   * 工作流中间节点仍然使用非流式callAI，只有最后一个LLM节点使用此方法
   * 
   * @param {Object} res - Express响应对象（已设置SSE头）
   * @param {Object} model - AI模型对象
   * @param {Array} messages - 消息数组
   * @param {Object} options - { temperature, max_tokens, timeout, onDelta }
   * @returns {Promise<string>} 完整的AI响应文本
   */
  static async callAIStream(res, model, messages, options = {}) {
    try {
      if (AICallHelper.isAzureConfig(model)) {
        return await AICallHelper.callAzureStreamAPI(res, model, messages, options);
      } else {
        return await AICallHelper.callStandardStreamAPI(res, model, messages, options);
      }
    } catch (error) {
      logger.error('AI流式调用失败:', {
        modelName: model?.name, provider: model?.provider, error: error.message
      });
      throw error;
    }
  }

  /**
   * 检测是否为Azure配置
   */
  static isAzureConfig(model) {
    if (model.provider === 'azure' || model.provider === 'azure-openai') return true;
    if (model.api_key && model.api_key.includes('|')) {
      if (model.api_key.split('|').length === 3) return true;
    }
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') return true;
    return false;
  }

  /**
   * 解析Azure配置
   */
  static parseAzureConfig(apiKey) {
    const parts = apiKey.split('|');
    if (parts.length === 3) {
      return { apiKey: parts[0].trim(), endpoint: parts[1].trim(), apiVersion: parts[2].trim() };
    }
    return null;
  }

  /**
   * 发送SSE事件（与AIStreamService格式一致）
   */
  static sendSSE(res, event, data) {
    try {
      if (res.writableEnded) return false;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (error) {
      logger.error('发送SSE失败:', error);
      return false;
    }
  }

  /**
   * 调用标准OpenAI格式API（非流式）
   */
  static async callStandardAPI(model, messages, options = {}) {
    const endpoint = model.api_endpoint.endsWith('/chat/completions')
      ? model.api_endpoint : `${model.api_endpoint}/chat/completions`;

    const requestData = {
      model: model.name,
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2000,
      stream: false
    };

    const headers = {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json'
    };

    if (endpoint.includes('openrouter')) {
      headers['HTTP-Referer'] = process.env.SITE_URL || 'https://ai.xingyuncl.com';
      headers['X-Title'] = 'AI Platform Agent';
      /* OpenRouter禁用推理输出，节省token */
      requestData.include_reasoning = false;
    }

    const response = await axios.post(endpoint, requestData, {
      headers, timeout: options.timeout || 120000
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }
    throw new Error('AI响应格式异常');
  }

  /**
   * v1.1: 调用标准OpenAI格式流式API
   * 解析SSE流并实时推送给客户端
   */
  static async callStandardStreamAPI(res, model, messages, options = {}) {
    const endpoint = model.api_endpoint.endsWith('/chat/completions')
      ? model.api_endpoint : `${model.api_endpoint}/chat/completions`;

    const requestData = {
      model: model.name,
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2000,
      stream: true
    };

    const headers = {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    };

    if (endpoint.includes('openrouter')) {
      headers['HTTP-Referer'] = process.env.SITE_URL || 'https://ai.xingyuncl.com';
      headers['X-Title'] = 'AI Platform Agent';
      requestData.include_reasoning = false;
    }

    const response = await axios({
      method: 'post', url: endpoint, data: requestData,
      headers, responseType: 'stream', timeout: options.timeout || 120000
    });

    return AICallHelper._handleStreamResponse(res, response, model, options);
  }

  /**
   * 调用Azure OpenAI API（非流式）
   */
  static async callAzureAPI(model, messages, options = {}) {
    const azureConfig = AICallHelper.parseAzureConfig(model.api_key);
    if (!azureConfig) throw new Error('Azure配置格式错误，需要格式：apiKey|endpoint|apiVersion');

    const { apiKey, endpoint, apiVersion } = azureConfig;
    let deploymentName = model.name;
    if (model.name.includes('/')) deploymentName = model.name.split('/').pop();

    const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const requestData = {
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2000,
      stream: false
    };

    const response = await axios.post(azureUrl, requestData, {
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: options.timeout || 120000
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }
    throw new Error('Azure AI响应格式异常');
  }

  /**
   * v1.1: 调用Azure流式API
   */
  static async callAzureStreamAPI(res, model, messages, options = {}) {
    const azureConfig = AICallHelper.parseAzureConfig(model.api_key);
    if (!azureConfig) throw new Error('Azure配置格式错误');

    const { apiKey, endpoint, apiVersion } = azureConfig;
    let deploymentName = model.name;
    if (model.name.includes('/')) deploymentName = model.name.split('/').pop();

    const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const requestData = {
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2000,
      stream: true
    };

    const response = await axios({
      method: 'post', url: azureUrl, data: requestData,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      responseType: 'stream', timeout: options.timeout || 120000
    });

    return AICallHelper._handleStreamResponse(res, response, model, options);
  }

  /**
   * v1.1: 通用流式响应处理（解析OpenAI SSE格式，推送给客户端）
   * 与AIStreamService._handleStreamResponse格式一致
   * 
   * @param {Object} res - Express响应对象
   * @param {Object} response - axios流式响应
   * @param {Object} model - AI模型对象
   * @param {Object} options - 选项
   * @returns {Promise<string>} 完整响应文本
   */
  static _handleStreamResponse(res, response, model, options = {}) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    let chunkCount = 0;
    const startTime = Date.now();

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
                logger.info('Agent流式传输完成[DONE]', {
                  model: model.name, chunkCount,
                  contentLength: fullContent.length,
                  totalTimeMs: Date.now() - startTime
                });
                resolve(fullContent);
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                /* 向客户端推送增量内容 */
                AICallHelper.sendSSE(res, 'message', { delta, fullContent });
                /* 回调通知（可选） */
                if (options.onDelta) options.onDelta(delta, fullContent);
              }
              if (parsed.choices?.[0]?.finish_reason === 'stop' && !isDone) {
                isDone = true;
                logger.info('Agent流式传输完成[stop]', {
                  model: model.name, chunkCount,
                  contentLength: fullContent.length,
                  totalTimeMs: Date.now() - startTime
                });
                resolve(fullContent);
              }
            } catch (e) {
              /* 解析单行失败不影响整体 */
            }
          }
        } catch (error) {
          logger.error('处理Agent流数据失败:', error);
        }
      });

      response.data.on('end', () => {
        if (!isDone) {
          isDone = true;
          resolve(fullContent);
        }
      });

      response.data.on('error', (error) => {
        logger.error('Agent流式响应错误:', error);
        reject(error);
      });

      /* 客户端断开连接时也要resolve，防止Promise泄漏 */
      res.on('close', () => {
        if (!isDone) {
          isDone = true;
          resolve(fullContent);
        }
      });
    });
  }

  /**
   * 估算文本的Token数量
   */
  static estimateTokens(content) {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }
}

module.exports = AICallHelper;
