/**
 * 问题分类节点 - 使用AI对用户问题进行智能分类
 * v1.0 - 基础分类功能（单输出，第一阶段）
 * 
 * 功能：
 * - 使用选定的AI模型进行问题分类
 * - 支持背景知识提供分类上下文
 * - 支持最多100个分类类别
 * - 输出分类结果供下游节点使用
 * 
 * 配置参数：
 * - model: AI模型名称
 * - background_knowledge: 背景知识/分类说明
 * - history_turns: 历史轮数
 * - categories: 分类列表 [{id, name, description}]
 */

const BaseNode = require('./BaseNode');
const AIModel = require('../../../models/AIModel');
const axios = require('axios');
const logger = require('../../../utils/logger');

class ClassifierNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
    this.type = 'classifier';
  }

  /**
   * 获取配置（兼容旧版和新版）
   * @param {string} key - 配置键名
   * @param {*} defaultValue - 默认值
   * @returns {*} 配置值
   */
  getConfig(key, defaultValue = undefined) {
    // 优先从 data.config 读取（新版）
    if (this.data && this.data.config && this.data.config[key] !== undefined) {
      return this.data.config[key];
    }
    // 兼容旧版直接从 data 读取
    if (this.data && this.data[key] !== undefined) {
      return this.data[key];
    }
    return defaultValue;
  }

  /**
   * 验证节点配置
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];
    
    // 验证模型
    const modelName = this.getConfig('model');
    if (!modelName) {
      errors.push('必须选择AI模型');
    }
    
    // 验证分类列表
    const categories = this.getConfig('categories') || [];
    if (categories.length === 0) {
      errors.push('至少需要定义一个分类');
    }
    
    if (categories.length > 100) {
      errors.push('分类数量不能超过100个');
    }
    
    // 验证每个分类
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      if (!cat.name || cat.name.trim() === '') {
        errors.push(`分类 ${i + 1} 缺少名称`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 执行问题分类
   * @param {Object} context - 执行上下文
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置
   * @returns {Promise<Object>} 分类结果
   */
  async execute(context = {}, userId, nodeTypeConfig) {
    try {
      this.log('info', '问题分类节点开始执行', {
        userId,
        hasUpstream: !!context.upstreamOutput
      });

      // 1. 获取配置
      const modelName = this.getConfig('model');
      const backgroundKnowledge = this.getConfig('background_knowledge') || '';
      const historyTurns = parseInt(this.getConfig('history_turns', 6));
      const categories = this.getConfig('categories') || [];

      if (!modelName) {
        throw new Error('未选择AI模型');
      }

      if (categories.length === 0) {
        throw new Error('未定义分类类别');
      }

      this.log('info', '分类配置', {
        modelName,
        categoryCount: categories.length,
        hasBackgroundKnowledge: !!backgroundKnowledge,
        historyTurns
      });

      // 2. 查找模型
      const model = await AIModel.findByName(modelName);
      if (!model) {
        throw new Error(`AI模型不存在: ${modelName}`);
      }

      if (!model.is_active) {
        throw new Error(`AI模型已禁用: ${model.display_name}`);
      }

      // 3. 获取用户问题
      let userQuery = '';
      
      // 优先从上游输出获取
      if (context.upstreamOutput) {
        if (typeof context.upstreamOutput === 'object') {
          userQuery = context.upstreamOutput.query || 
                     context.upstreamOutput.content || 
                     JSON.stringify(context.upstreamOutput);
        } else {
          userQuery = String(context.upstreamOutput);
        }
      }
      
      // 如果上游没有，从输入获取
      if (!userQuery && context.input) {
        userQuery = context.input.query || '';
      }

      if (!userQuery) {
        throw new Error('无法获取用户问题');
      }

      this.log('info', '用户问题', {
        queryLength: userQuery.length,
        queryPreview: userQuery.substring(0, 100)
      });

      // 4. 获取历史消息
      const inputMessages = context.input?.messages || [];
      let recentMessages = [];
      if (historyTurns > 0 && inputMessages.length > 0) {
        const messagesToKeep = historyTurns * 2;
        recentMessages = inputMessages.slice(-messagesToKeep);
      }

      // 5. 构建分类提示词
      const classificationPrompt = this.buildClassificationPrompt(
        userQuery,
        categories,
        backgroundKnowledge,
        recentMessages
      );

      this.log('info', '分类提示词构建完成', {
        promptLength: classificationPrompt.length
      });

      // 6. 调用AI进行分类
      const messages = [
        {
          role: 'system',
          content: this.buildSystemPrompt(categories, backgroundKnowledge)
        },
        {
          role: 'user',
          content: classificationPrompt
        }
      ];

      const response = await this.callAI(model, messages, {
        temperature: 0.1, // 低温度保证分类稳定性
        max_tokens: 100   // 分类只需要短回复
      });

      this.log('info', 'AI分类响应', {
        response: response.substring(0, 200)
      });

      // 7. 解析分类结果
      const classificationResult = this.parseClassificationResult(response, categories);

      this.log('info', '分类结果', {
        categoryId: classificationResult.category_id,
        categoryName: classificationResult.category_name,
        confidence: classificationResult.confidence
      });

      // 8. 返回结果
      return {
        output: {
          category_id: classificationResult.category_id,
          category_name: classificationResult.category_name,
          category_index: classificationResult.category_index,
          confidence: classificationResult.confidence,
          original_query: userQuery,
          all_categories: categories.map(c => ({ id: c.id, name: c.name }))
        },
        credits_used: nodeTypeConfig?.credits_per_execution || 0
      };

    } catch (error) {
      this.log('error', '问题分类节点执行失败', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`问题分类失败: ${error.message}`);
    }
  }

  /**
   * 构建系统提示词
   * @param {Array} categories - 分类列表
   * @param {string} backgroundKnowledge - 背景知识
   * @returns {string} 系统提示词
   */
  buildSystemPrompt(categories, backgroundKnowledge) {
    let systemPrompt = `你是一个专业的问题分类器。你的任务是将用户的问题准确分类到预定义的类别中。

【分类规则】
1. 仔细阅读用户问题和对话历史
2. 根据背景知识和分类描述判断最匹配的类别
3. 只输出分类编号，不要输出任何其他内容
4. 如果无法确定，选择最接近的类别

【可用分类】
`;

    // 添加分类列表
    categories.forEach((cat, index) => {
      systemPrompt += `${index + 1}. ${cat.name}`;
      if (cat.description) {
        systemPrompt += ` - ${cat.description}`;
      }
      systemPrompt += '\n';
    });

    // 添加背景知识
    if (backgroundKnowledge && backgroundKnowledge.trim()) {
      systemPrompt += `\n【背景知识】\n${backgroundKnowledge}\n`;
    }

    systemPrompt += `\n【输出格式】
只输出一个数字，表示分类编号（1-${categories.length}）。不要输出其他任何内容。`;

    return systemPrompt;
  }

  /**
   * 构建分类提示词
   * @param {string} userQuery - 用户问题
   * @param {Array} categories - 分类列表
   * @param {string} backgroundKnowledge - 背景知识
   * @param {Array} recentMessages - 历史消息
   * @returns {string} 分类提示词
   */
  buildClassificationPrompt(userQuery, categories, backgroundKnowledge, recentMessages) {
    let prompt = '';

    // 添加历史对话（如果有）
    if (recentMessages.length > 0) {
      prompt += '【对话历史】\n';
      recentMessages.forEach(msg => {
        const role = msg.role === 'user' ? '用户' : 'AI';
        prompt += `${role}: ${msg.content}\n`;
      });
      prompt += '\n';
    }

    // 添加当前问题
    prompt += `【当前问题】\n${userQuery}\n\n`;

    // 添加分类选项（简化版）
    prompt += '【请选择分类编号】\n';
    categories.forEach((cat, index) => {
      prompt += `${index + 1}. ${cat.name}\n`;
    });

    prompt += '\n请输出分类编号（只输出数字）：';

    return prompt;
  }

  /**
   * 解析分类结果
   * @param {string} response - AI响应
   * @param {Array} categories - 分类列表
   * @returns {Object} 分类结果
   */
  parseClassificationResult(response, categories) {
    // 提取数字
    const match = response.match(/\d+/);
    
    if (match) {
      const index = parseInt(match[0]) - 1; // 转为0-based索引
      
      if (index >= 0 && index < categories.length) {
        const category = categories[index];
        return {
          category_id: category.id || `cat-${index}`,
          category_name: category.name,
          category_index: index,
          confidence: 'high'
        };
      }
    }

    // 如果无法解析，尝试模糊匹配分类名称
    const lowerResponse = response.toLowerCase();
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      if (lowerResponse.includes(cat.name.toLowerCase())) {
        return {
          category_id: cat.id || `cat-${i}`,
          category_name: cat.name,
          category_index: i,
          confidence: 'medium'
        };
      }
    }

    // 默认返回第一个分类
    this.log('warn', '无法解析分类结果，使用默认分类', {
      response,
      defaultCategory: categories[0]?.name
    });

    return {
      category_id: categories[0]?.id || 'cat-0',
      category_name: categories[0]?.name || '未分类',
      category_index: 0,
      confidence: 'low'
    };
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
      temperature: options.temperature || 0.1,
      max_tokens: options.max_tokens || 100,
      stream: false
    };

    const headers = {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json'
    };

    // 如果是OpenRouter，添加额外的headers
    if (endpoint.includes('openrouter')) {
      headers['HTTP-Referer'] = 'https://ai.xingyuncl.com';
      headers['X-Title'] = 'AI Platform Agent Classifier';
    }

    const response = await axios.post(endpoint, requestData, {
      headers,
      timeout: 60000 // 1分钟超时（分类应该很快）
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
      temperature: options.temperature || 0.1,
      max_tokens: options.max_tokens || 100,
      stream: false
    };

    const response = await axios.post(azureUrl, requestData, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    }

    throw new Error('Azure AI响应格式异常');
  }

  /**
   * 获取节点消耗的积分
   */
  getCreditsPerExecution() {
    return 5; // 分类节点消耗较少积分
  }
}

module.exports = ClassifierNode;
