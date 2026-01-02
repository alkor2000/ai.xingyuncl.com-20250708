/**
 * AI对话节点
 * 调用大语言模型进行对话和推理（非流式，用于工作流执行）
 * 支持对话历史管理、轮数控制和上游节点输出传递
 * v2.0 - 添加知识库上下文支持
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
   * 获取配置（兼容旧版和新版）
   */
  getConfig(key, defaultValue = undefined) {
    // 优先从 data.config 读取（新版）
    if (this.data.config && this.data.config[key] !== undefined) {
      return this.data.config[key];
    }
    // 兼容旧版直接从 data 读取
    if (this.data[key] !== undefined) {
      return this.data[key];
    }
    return defaultValue;
  }

  /**
   * 检查上游输出是否为知识库节点的输出
   * @param {*} upstreamOutput - 上游节点输出
   * @returns {boolean}
   */
  isKnowledgeOutput(upstreamOutput) {
    if (!upstreamOutput || typeof upstreamOutput !== 'object') {
      return false;
    }
    // 知识库节点输出包含 knowledge_context 字段
    return 'knowledge_context' in upstreamOutput;
  }

  /**
   * 提取上游输出的文本内容
   * v2.0 - 支持知识库节点输出
   * @param {*} upstreamOutput - 上游节点输出
   * @returns {string} 提取的文本内容
   */
  extractUpstreamContent(upstreamOutput) {
    if (!upstreamOutput) {
      return null;
    }

    // 如果是对象，尝试提取内容
    if (typeof upstreamOutput === 'object') {
      // 优先级1: knowledge_context（知识库节点输出）
      if (upstreamOutput.knowledge_context) {
        return upstreamOutput.knowledge_context;
      }
      
      // 优先级2: content 字段（LLM节点输出）
      if (upstreamOutput.content) {
        return upstreamOutput.content;
      }
      
      // 优先级3: query 字段（开始节点输出）
      if (upstreamOutput.query) {
        return upstreamOutput.query;
      }
      
      // 优先级4: 如果没有特定字段，转为 JSON 字符串
      return JSON.stringify(upstreamOutput);
    }

    // 如果是字符串，直接返回
    if (typeof upstreamOutput === 'string') {
      return upstreamOutput;
    }

    // 其他类型，转为字符串
    return String(upstreamOutput);
  }

  /**
   * 执行AI对话节点
   * v2.0 - 支持知识库上下文注入
   * @param {Object} context - 执行上下文
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置（包含积分消耗）
   * @returns {Promise<Object>} AI响应结果
   */
  async execute(context, userId, nodeTypeConfig) {
    try {
      this.log('info', 'AI对话节点开始执行', { 
        userId, 
        nodeData: this.data,
        hasUpstream: !!context.upstreamOutput
      });

      // 1. 获取模型名称（从 config.model 或 data.model_name）
      const modelName = this.getConfig('model') || this.getConfig('model_name');
      
      if (!modelName) {
        throw new Error('未选择AI模型');
      }

      this.log('info', '查找AI模型', { modelName });

      // 2. 根据名称查找模型
      const model = await AIModel.findByName(modelName);
      if (!model) {
        throw new Error(`AI模型不存在: ${modelName}`);
      }

      if (!model.is_active) {
        throw new Error(`AI模型已禁用: ${model.display_name}`);
      }

      this.log('info', '使用AI模型', { 
        modelId: model.id, 
        modelName: model.name,
        displayName: model.display_name
      });

      // 3. 获取历史轮数配置（默认10轮）
      const historyTurns = parseInt(this.getConfig('history_turns', 10));
      
      this.log('info', '历史轮数配置', { historyTurns });

      // 4. 获取对话历史（从输入数据）
      const inputMessages = context.input?.messages || [];
      
      // 5. 截取历史（保留最近N轮，每轮包含user+assistant）
      let recentMessages = [];
      if (historyTurns > 0 && inputMessages.length > 0) {
        // 每轮包含2条消息（user + assistant），所以取最后 historyTurns * 2 条
        const messagesToKeep = historyTurns * 2;
        recentMessages = inputMessages.slice(-messagesToKeep);
        
        this.log('info', '历史消息截取', {
          totalMessages: inputMessages.length,
          keptMessages: recentMessages.length,
          historyTurns
        });
      }

      // 6. 获取系统提示词和用户提示词模板
      const systemPromptTemplate = this.getConfig('system_prompt', '');
      const userPromptTemplate = this.getConfig('user_prompt') || this.getConfig('prompt');

      // ========== v2.0 新增：处理知识库上下文 ==========
      let knowledgeContext = '';
      let originalUserQuery = context.input?.query || '';
      
      // 检查上游是否为知识库节点
      if (context.upstreamOutput && this.isKnowledgeOutput(context.upstreamOutput)) {
        knowledgeContext = context.upstreamOutput.knowledge_context || '';
        
        this.log('info', '检测到知识库上下文', {
          hasKnowledgeContext: !!knowledgeContext,
          contextLength: knowledgeContext.length,
          wikiCount: context.upstreamOutput.wiki_count || 0,
          totalTokens: context.upstreamOutput.total_tokens || 0
        });
      }
      // ========== v2.0 新增结束 ==========

      // 7. 获取当前用户消息（优先级：模板 > 上游输出 > 原始输入）
      let currentUserMessage;
      
      if (userPromptTemplate) {
        // 优先级1: 如果配置了提示词模板，使用模板并替换变量
        currentUserMessage = this.replaceVariables(userPromptTemplate, context);
        this.log('info', '使用提示词模板', { templateLength: userPromptTemplate.length });
      } 
      else if (knowledgeContext) {
        // v2.0 优先级2: 如果有知识库上下文，将其与用户问题组合
        currentUserMessage = this.buildKnowledgePrompt(knowledgeContext, originalUserQuery);
        this.log('info', '使用知识库上下文 + 用户问题', { 
          knowledgeLength: knowledgeContext.length,
          queryLength: originalUserQuery.length,
          combinedLength: currentUserMessage.length
        });
      }
      else if (context.upstreamOutput) {
        // 优先级3: 如果有上游节点输出，使用上游输出
        currentUserMessage = this.extractUpstreamContent(context.upstreamOutput);
        this.log('info', '使用上游节点输出', { 
          upstreamType: typeof context.upstreamOutput,
          messageLength: currentUserMessage.length 
        });
      }
      else if (context.input && context.input.query) {
        // 优先级4: 使用输入的 query
        currentUserMessage = context.input.query;
        this.log('info', '使用原始输入query', { queryLength: currentUserMessage.length });
      }
      else if (context.input) {
        // 优先级5: 使用整个输入对象
        currentUserMessage = JSON.stringify(context.input);
        this.log('info', '使用整个输入对象', { inputLength: currentUserMessage.length });
      }
      else {
        throw new Error('无法获取用户输入：没有提示词模板、上游输出或输入数据');
      }

      // 8. 处理系统提示词变量替换
      const systemPrompt = systemPromptTemplate 
        ? this.replaceVariables(systemPromptTemplate, context)
        : '';

      this.log('debug', '提示词处理完成', {
        hasSystemPrompt: !!systemPrompt,
        hasKnowledgeContext: !!knowledgeContext,
        currentMessageLength: currentUserMessage.length,
        historyMessageCount: recentMessages.length
      });

      // 9. 构建完整消息数组
      const messages = [];
      
      // 添加系统提示词（始终在最前面）
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      
      // 添加历史消息（按时间顺序）
      messages.push(...recentMessages);
      
      // 添加当前用户消息
      messages.push({ role: 'user', content: currentUserMessage });

      this.log('info', '消息数组构建完成', {
        totalMessages: messages.length,
        systemPromptIncluded: !!systemPrompt,
        knowledgeContextIncluded: !!knowledgeContext,
        historyIncluded: recentMessages.length,
        structure: messages.map(m => m.role)
      });

      // 10. 获取模型参数
      const temperature = parseFloat(this.getConfig('temperature', 0.7));
      const maxTokens = parseInt(this.getConfig('max_tokens', 2000));

      // 11. 调用AI（非流式）
      const response = await this.callAI(model, messages, {
        temperature,
        max_tokens: maxTokens
      });

      this.log('info', 'AI响应成功', {
        responseLength: response.length,
        tokensUsed: this.estimateTokens(response)
      });

      // 12. 返回结果（包含积分消耗信息）
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
   * v2.0 新增：构建包含知识库上下文的提示词
   * 将知识库内容和用户问题组合成完整的提示词
   * @param {string} knowledgeContext - 知识库内容
   * @param {string} userQuery - 用户问题
   * @returns {string} 组合后的提示词
   */
  buildKnowledgePrompt(knowledgeContext, userQuery) {
    // 如果没有知识库内容，直接返回用户问题
    if (!knowledgeContext || knowledgeContext.trim() === '') {
      return userQuery;
    }
    
    // 如果没有用户问题，返回让AI总结知识库的提示
    if (!userQuery || userQuery.trim() === '') {
      return `请阅读以下知识库内容：\n\n${knowledgeContext}\n\n请根据以上内容提供帮助。`;
    }
    
    // 组合知识库内容和用户问题
    const prompt = `请参考以下知识库内容来回答用户的问题：

【知识库内容】
${knowledgeContext}

【用户问题】
${userQuery}

请根据知识库内容准确回答用户的问题。如果知识库中没有相关信息，请说明并尽可能提供帮助。`;

    return prompt;
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

    const modelName = this.getConfig('model') || this.getConfig('model_name');
    if (!modelName) {
      errors.push('必须选择AI模型');
    }

    // 验证历史轮数
    const historyTurns = this.getConfig('history_turns');
    if (historyTurns !== undefined) {
      const turns = parseInt(historyTurns);
      if (isNaN(turns) || turns < 0 || turns > 100) {
        errors.push('历史轮数必须在0-100之间');
      }
    }

    const temperature = this.getConfig('temperature');
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
      errors.push('温度值必须在0-2之间');
    }

    const maxTokens = this.getConfig('max_tokens');
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
