/**
 * AI对话节点
 * 调用大语言模型进行对话和推理（非流式，用于工作流执行）
 */

const BaseNode = require('./BaseNode');
const AIModel = require('../../../models/AIModel');
const axios = require('axios');
const logger = require('../../../utils/logger');

class LLMNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
  }

  /**
   * 执行AI对话节点
   * @param {Object} context - 执行上下文
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置（包含积分消耗）
   * @returns {Promise<Object>} AI响应结果
   */
  async execute(context, userId, nodeTypeConfig) {
    try {
      this.log('info', 'AI对话节点开始执行', { 
        userId, 
        nodeConfig: this.data 
      });

      // 1. 验证必填字段
      if (!this.data.model_id) {
        throw new Error('未选择AI模型');
      }

      if (!this.data.user_prompt) {
        throw new Error('用户提示词不能为空');
      }

      // 2. 获取模型信息
      const model = await AIModel.findById(this.data.model_id);
      if (!model) {
        throw new Error(`AI模型不存在: ${this.data.model_id}`);
      }

      if (!model.is_active) {
        throw new Error(`AI模型已禁用: ${model.display_name}`);
      }

      this.log('info', '使用AI模型', { 
        modelId: model.id, 
        modelName: model.name,
        displayName: model.display_name
      });

      // 3. 处理变量替换
      const systemPrompt = this.data.system_prompt 
        ? this.replaceVariables(this.data.system_prompt, context)
        : '';

      const userPrompt = this.replaceVariables(this.data.user_prompt, context);

      this.log('debug', '变量替换后的提示词', {
        systemPrompt: systemPrompt ? systemPrompt.substring(0, 100) + '...' : '',
        userPrompt: userPrompt.substring(0, 100) + '...'
      });

      // 4. 构建消息数组
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: userPrompt });

      // 5. 调用AI（非流式）
      const response = await this.callAI(model, messages, {
        temperature: this.data.temperature || 0.7,
        max_tokens: this.data.max_tokens || 2000
      });

      this.log('info', 'AI响应成功', {
        responseLength: response.length,
        tokensUsed: this.estimateTokens(response)
      });

      // 6. 返回结果（包含积分消耗信息）
      return {
        success: true,
        output: {
          content: response,
          model: model.name,
          display_name: model.display_name,
          tokens_used: this.estimateTokens(response)
        },
        credits_used: nodeTypeConfig.credits_per_execution || 0
      };

    } catch (error) {
      this.log('error', 'AI对话节点执行失败', { 
        error: error.message,
        stack: error.stack
      });

      throw new Error(`AI对话失败: ${error.message}`);
    }
  }

  /**
   * 调用AI模型（非流式）
   * @param {Object} model - AI模型对象
   * @param {Array} messages - 消息数组
   * @param {Object} options - 调用参数
   * @returns {Promise<string>} AI响应内容
   */
  async callAI(model, messages, options = {}) {
    try {
      // 检测是否为Azure配置
      if (this.isAzureConfig(model)) {
        return await this.callAzureAPI(model, messages, options);
      } else {
        return await this.callStandardAPI(model, messages, options);
      }
    } catch (error) {
      logger.error('调用AI失败:', error);
      throw error;
    }
  }

  /**
   * 检测是否为Azure配置
   */
  isAzureConfig(model) {
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
   * 解析Azure配置
   */
  parseAzureConfig(apiKey) {
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
   */
  async callStandardAPI(model, messages, options) {
    const endpoint = model.api_endpoint.endsWith('/chat/completions')
      ? model.api_endpoint
      : `${model.api_endpoint}/chat/completions`;

    const requestData = {
      model: model.name,
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2000,
      stream: false
    };

    const headers = {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json'
    };

    // 如果是OpenRouter，添加额外的headers
    if (endpoint.includes('openrouter')) {
      headers['HTTP-Referer'] = 'https://ai.xingyuncl.com';
      headers['X-Title'] = 'AI Platform Agent';
    }

    const response = await axios.post(endpoint, requestData, {
      headers,
      timeout: 120000 // 2分钟超时
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }

    throw new Error('AI响应格式异常');
  }

  /**
   * 调用Azure OpenAI API
   */
  async callAzureAPI(model, messages, options) {
    const azureConfig = this.parseAzureConfig(model.api_key);
    if (!azureConfig) {
      throw new Error('Azure配置格式错误');
    }

    const { apiKey, endpoint, apiVersion } = azureConfig;

    // 提取deployment名称
    let deploymentName = model.name;
    if (model.name.includes('/')) {
      const parts = model.name.split('/');
      deploymentName = parts[parts.length - 1];
    }

    // 构建Azure URL
    const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const requestData = {
      messages: messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2000,
      stream: false
    };

    const response = await axios.post(azureUrl, requestData, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }

    throw new Error('Azure AI响应格式异常');
  }

  /**
   * 估算Token数量
   */
  estimateTokens(content) {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }

  /**
   * 验证LLM节点配置
   */
  validate() {
    const errors = [];

    if (!this.data.model_id) {
      errors.push('必须选择AI模型');
    }

    if (!this.data.user_prompt) {
      errors.push('用户提示词不能为空');
    }

    const temperature = this.data.temperature;
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
      errors.push('温度值必须在0-2之间');
    }

    const maxTokens = this.data.max_tokens;
    if (maxTokens !== undefined && (maxTokens < 100 || maxTokens > 4000)) {
      errors.push('最大Token数必须在100-4000之间');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = LLMNode;
