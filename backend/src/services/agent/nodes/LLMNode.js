/**
 * AI对话节点
 * 调用大语言模型进行对话和推理（非流式，用于工作流执行）
 * 支持对话历史管理、轮数控制和上游节点输出传递
 * v2.0 - 添加知识库上下文支持
 * v2.1 - P1重构：AI调用方法提取到AICallHelper，消除代码重复
 * v2.2 - 修复max_tokens验证上限与前端一致（100000）
 */

const BaseNode = require('./BaseNode');
const AICallHelper = require('./AICallHelper');
const AIModel = require('../../../models/AIModel');
const logger = require('../../../utils/logger');

class LLMNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
  }

  /**
   * 获取配置（兼容旧版和新版）
   */
  getConfig(key, defaultValue = undefined) {
    /* 优先从 data.config 读取（新版） */
    if (this.data.config && this.data.config[key] !== undefined) {
      return this.data.config[key];
    }
    /* 兼容旧版直接从 data 读取 */
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
    /* 知识库节点输出包含 knowledge_context 字段 */
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

    if (typeof upstreamOutput === 'object') {
      /* 优先级1: knowledge_context（知识库节点输出） */
      if (upstreamOutput.knowledge_context) {
        return upstreamOutput.knowledge_context;
      }
      /* 优先级2: content 字段（LLM节点输出） */
      if (upstreamOutput.content) {
        return upstreamOutput.content;
      }
      /* 优先级3: query 字段（开始节点输出） */
      if (upstreamOutput.query) {
        return upstreamOutput.query;
      }
      /* 优先级4: 转为 JSON 字符串 */
      return JSON.stringify(upstreamOutput);
    }

    if (typeof upstreamOutput === 'string') {
      return upstreamOutput;
    }

    return String(upstreamOutput);
  }

  /**
   * 执行AI对话节点
   * v2.0 - 支持知识库上下文注入
   * v2.1 - 使用AICallHelper统一调用AI
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

      /* 1. 获取模型名称 */
      const modelName = this.getConfig('model') || this.getConfig('model_name');
      
      if (!modelName) {
        throw new Error('未选择AI模型');
      }

      this.log('info', '查找AI模型', { modelName });

      /* 2. 查找模型 */
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

      /* 3. 获取历史轮数配置（默认10轮） */
      const historyTurns = parseInt(this.getConfig('history_turns', 10));
      this.log('info', '历史轮数配置', { historyTurns });

      /* 4. 获取对话历史 */
      const inputMessages = context.input?.messages || [];
      
      /* 5. 截取历史（保留最近N轮，每轮包含user+assistant） */
      let recentMessages = [];
      if (historyTurns > 0 && inputMessages.length > 0) {
        const messagesToKeep = historyTurns * 2;
        recentMessages = inputMessages.slice(-messagesToKeep);
        
        this.log('info', '历史消息截取', {
          totalMessages: inputMessages.length,
          keptMessages: recentMessages.length,
          historyTurns
        });
      }

      /* 6. 获取系统提示词和用户提示词模板 */
      const systemPromptTemplate = this.getConfig('system_prompt', '');
      const userPromptTemplate = this.getConfig('user_prompt') || this.getConfig('prompt');

      /* ========== v2.0: 处理知识库上下文 ========== */
      let knowledgeContext = '';
      let originalUserQuery = context.input?.query || '';
      
      if (context.upstreamOutput && this.isKnowledgeOutput(context.upstreamOutput)) {
        knowledgeContext = context.upstreamOutput.knowledge_context || '';
        
        this.log('info', '检测到知识库上下文', {
          hasKnowledgeContext: !!knowledgeContext,
          contextLength: knowledgeContext.length,
          wikiCount: context.upstreamOutput.wiki_count || 0,
          totalTokens: context.upstreamOutput.total_tokens || 0
        });
      }

      /* 7. 获取当前用户消息（多级优先级） */
      let currentUserMessage;
      
      if (userPromptTemplate) {
        /* 优先级1: 提示词模板 */
        currentUserMessage = this.replaceVariables(userPromptTemplate, context);
        this.log('info', '使用提示词模板', { templateLength: userPromptTemplate.length });
      } 
      else if (knowledgeContext) {
        /* 优先级2: 知识库上下文 + 用户问题 */
        currentUserMessage = this.buildKnowledgePrompt(knowledgeContext, originalUserQuery);
        this.log('info', '使用知识库上下文 + 用户问题', { 
          knowledgeLength: knowledgeContext.length,
          queryLength: originalUserQuery.length,
          combinedLength: currentUserMessage.length
        });
      }
      else if (context.upstreamOutput) {
        /* 优先级3: 上游节点输出 */
        currentUserMessage = this.extractUpstreamContent(context.upstreamOutput);
        this.log('info', '使用上游节点输出', { 
          upstreamType: typeof context.upstreamOutput,
          messageLength: currentUserMessage.length 
        });
      }
      else if (context.input && context.input.query) {
        /* 优先级4: 输入的query */
        currentUserMessage = context.input.query;
        this.log('info', '使用原始输入query', { queryLength: currentUserMessage.length });
      }
      else if (context.input) {
        /* 优先级5: 整个输入对象 */
        currentUserMessage = JSON.stringify(context.input);
        this.log('info', '使用整个输入对象', { inputLength: currentUserMessage.length });
      }
      else {
        throw new Error('无法获取用户输入：没有提示词模板、上游输出或输入数据');
      }

      /* 8. 系统提示词变量替换 */
      const systemPrompt = systemPromptTemplate 
        ? this.replaceVariables(systemPromptTemplate, context)
        : '';

      this.log('debug', '提示词处理完成', {
        hasSystemPrompt: !!systemPrompt,
        hasKnowledgeContext: !!knowledgeContext,
        currentMessageLength: currentUserMessage.length,
        historyMessageCount: recentMessages.length
      });

      /* 9. 构建完整消息数组 */
      const messages = [];
      
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      
      messages.push(...recentMessages);
      messages.push({ role: 'user', content: currentUserMessage });

      this.log('info', '消息数组构建完成', {
        totalMessages: messages.length,
        systemPromptIncluded: !!systemPrompt,
        knowledgeContextIncluded: !!knowledgeContext,
        historyIncluded: recentMessages.length,
        structure: messages.map(m => m.role)
      });

      /* 10. 获取模型参数 */
      const temperature = parseFloat(this.getConfig('temperature', 0.7));
      const maxTokens = parseInt(this.getConfig('max_tokens', 2000));

      /* 11. 调用AI（v2.1: 使用公共AICallHelper） */
      const response = await AICallHelper.callAI(model, messages, {
        temperature,
        max_tokens: maxTokens
      });

      this.log('info', 'AI响应成功', {
        responseLength: response.length,
        tokensUsed: AICallHelper.estimateTokens(response)
      });

      /* 12. 返回结果 */
      return {
        success: true,
        output: {
          content: response,
          model: model.name,
          display_name: model.display_name,
          tokens_used: AICallHelper.estimateTokens(response)
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
   * v2.0: 构建包含知识库上下文的提示词
   * @param {string} knowledgeContext - 知识库内容
   * @param {string} userQuery - 用户问题
   * @returns {string} 组合后的提示词
   */
  buildKnowledgePrompt(knowledgeContext, userQuery) {
    if (!knowledgeContext || knowledgeContext.trim() === '') {
      return userQuery;
    }
    
    if (!userQuery || userQuery.trim() === '') {
      return `请阅读以下知识库内容：\n\n${knowledgeContext}\n\n请根据以上内容提供帮助。`;
    }
    
    const prompt = `请参考以下知识库内容来回答用户的问题：

【知识库内容】
${knowledgeContext}

【用户问题】
${userQuery}

请根据知识库内容准确回答用户的问题。如果知识库中没有相关信息，请说明并尽可能提供帮助。`;

    return prompt;
  }

  /**
   * 验证LLM节点配置
   * v2.2 修复：max_tokens上限从8192改为100000，与前端ConfigPanel一致
   */
  validate() {
    const errors = [];

    const modelName = this.getConfig('model') || this.getConfig('model_name');
    if (!modelName) {
      errors.push('必须选择AI模型');
    }

    /* 验证历史轮数 */
    const historyTurns = this.getConfig('history_turns');
    if (historyTurns !== undefined) {
      const turns = parseInt(historyTurns);
      if (isNaN(turns) || turns < 0 || turns > 100) {
        errors.push('历史轮数必须在0-100之间');
      }
    }

    /* 验证温度 */
    const temperature = this.getConfig('temperature');
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
      errors.push('温度值必须在0-2之间');
    }

    /* v2.2 修复：上限从8192提升到100000，与前端ConfigPanel v2.6一致 */
    const maxTokens = this.getConfig('max_tokens');
    if (maxTokens !== undefined && (maxTokens < 100 || maxTokens > 100000)) {
      errors.push('最大Token数必须在100-100000之间');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = LLMNode;
