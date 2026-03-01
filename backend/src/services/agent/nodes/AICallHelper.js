/**
 * AI调用辅助工具类
 * v1.0 - 从LLMNode和ClassifierNode中提取的公共AI调用方法
 * 
 * 统一管理：
 * - 标准OpenAI格式API调用
 * - Azure OpenAI API调用
 * - Azure配置检测和解析
 * - Token估算
 * 
 * 避免LLMNode和ClassifierNode各自维护一份相同的代码，
 * 确保修改API调用逻辑时只需改一处
 */

const axios = require('axios');
const logger = require('../../../utils/logger');

class AICallHelper {
  /**
   * 调用AI模型（非流式）- 统一入口
   * 自动检测Azure/标准API并路由到对应方法
   * @param {Object} model - AI模型对象（包含name, api_key, api_endpoint, provider等）
   * @param {Array} messages - 消息数组 [{role, content}]
   * @param {Object} options - 调用参数
   * @param {number} options.temperature - 温度值（0-2）
   * @param {number} options.max_tokens - 最大Token数
   * @param {number} options.timeout - 超时时间（毫秒），默认120000
   * @returns {Promise<string>} AI响应文本内容
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
        modelName: model?.name,
        provider: model?.provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 检测是否为Azure配置
   * 三种判断方式：
   * 1. provider字段明确标注azure
   * 2. api_key包含三段式格式（key|endpoint|version）
   * 3. api_endpoint为azure占位符
   * @param {Object} model - AI模型对象
   * @returns {boolean} 是否为Azure配置
   */
  static isAzureConfig(model) {
    // 方式1：provider字段
    if (model.provider === 'azure' || model.provider === 'azure-openai') {
      return true;
    }
    
    // 方式2：api_key三段式格式
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|');
      if (parts.length === 3) {
        return true;
      }
    }
    
    // 方式3：api_endpoint占位符
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') {
      return true;
    }
    
    return false;
  }

  /**
   * 解析Azure配置
   * 从三段式api_key中提取：apiKey|endpoint|apiVersion
   * @param {string} apiKey - 三段式API密钥
   * @returns {Object|null} { apiKey, endpoint, apiVersion } 或 null
   */
  static parseAzureConfig(apiKey) {
    const parts = apiKey.split('|');
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
   * 调用标准OpenAI格式API
   * 兼容OpenAI、OpenRouter、自建API等所有遵循OpenAI格式的服务
   * @param {Object} model - AI模型对象
   * @param {Array} messages - 消息数组
   * @param {Object} options - 调用参数
   * @returns {Promise<string>} AI响应文本内容
   */
  static async callStandardAPI(model, messages, options = {}) {
    // 构建API端点URL
    const endpoint = model.api_endpoint.endsWith('/chat/completions')
      ? model.api_endpoint
      : `${model.api_endpoint}/chat/completions`;

    // 构建请求体
    const requestData = {
      model: model.name,
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2000,
      stream: false
    };

    // 构建请求头
    const headers = {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json'
    };

    // 如果是OpenRouter，添加额外的headers
    if (endpoint.includes('openrouter')) {
      headers['HTTP-Referer'] = process.env.SITE_URL || 'https://ai.xingyuncl.com';
      headers['X-Title'] = 'AI Platform Agent';
    }

    // 发送请求
    const response = await axios.post(endpoint, requestData, {
      headers,
      timeout: options.timeout || 120000 // 默认2分钟超时
    });

    // 解析响应
    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }

    throw new Error('AI响应格式异常');
  }

  /**
   * 调用Azure OpenAI API
   * Azure的API格式与标准OpenAI略有不同（URL结构、认证方式）
   * @param {Object} model - AI模型对象
   * @param {Array} messages - 消息数组
   * @param {Object} options - 调用参数
   * @returns {Promise<string>} AI响应文本内容
   */
  static async callAzureAPI(model, messages, options = {}) {
    // 解析Azure配置
    const azureConfig = AICallHelper.parseAzureConfig(model.api_key);
    if (!azureConfig) {
      throw new Error('Azure配置格式错误，需要格式：apiKey|endpoint|apiVersion');
    }

    const { apiKey, endpoint, apiVersion } = azureConfig;

    // 提取deployment名称（Azure使用deployment而非model名）
    let deploymentName = model.name;
    if (model.name.includes('/')) {
      const parts = model.name.split('/');
      deploymentName = parts[parts.length - 1];
    }

    // 构建Azure URL
    const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    // 构建请求体（Azure不需要model字段）
    const requestData = {
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2000,
      stream: false
    };

    // 发送请求（Azure使用api-key头而非Bearer token）
    const response = await axios.post(azureUrl, requestData, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: options.timeout || 120000
    });

    // 解析响应
    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }

    throw new Error('Azure AI响应格式异常');
  }

  /**
   * 估算文本的Token数量
   * 使用简单的中英文混合估算方法：
   * - 中文字符约 0.67 token/字
   * - 英文字符约 0.25 token/字
   * @param {string} content - 文本内容
   * @returns {number} 估算的Token数量
   */
  static estimateTokens(content) {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }
}

module.exports = AICallHelper;
