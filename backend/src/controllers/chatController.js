/**
 * 对话控制器
 */

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AIService = require('../services/aiService');
const User = require('../models/User');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { ValidationError, AuthorizationError, NotFoundError } = require('../utils/errors');

class ChatController {
  /**
   * 获取用户的会话列表
   * GET /api/chat/conversations
   */
  static async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const result = await Conversation.getUserConversations(userId, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      return ResponseHelper.paginated(res, result.conversations, result.pagination, '获取会话列表成功');
    } catch (error) {
      logger.error('获取会话列表失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取会话列表失败');
    }
  }

  /**
   * 创建新会话
   * POST /api/chat/conversations
   */
  static async createConversation(req, res) {
    try {
      const userId = req.user.id;
      const { title, model_name, system_prompt } = req.body;

      // 验证AI模型
      const isValidModel = await AIService.validateModel(model_name || 'gpt-3.5-turbo');
      if (!isValidModel) {
        return ResponseHelper.validation(res, ['选择的AI模型不可用']);
      }

      const conversation = await Conversation.create({
        user_id: userId,
        title: title || 'New Chat',
        model_name: model_name || 'gpt-3.5-turbo',
        system_prompt
      });

      logger.info('会话创建成功', { 
        userId, 
        conversationId: conversation.id,
        modelName: conversation.model_name 
      });

      return ResponseHelper.success(res, conversation.toJSON(), '会话创建成功', 201);
    } catch (error) {
      logger.error('会话创建失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '会话创建失败');
    }
  }

  /**
   * 获取会话详情
   * GET /api/chat/conversations/:id
   */
  static async getConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      return ResponseHelper.success(res, conversation.toJSON(), '获取会话成功');
    } catch (error) {
      logger.error('获取会话详情失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取会话失败');
    }
  }

  /**
   * 更新会话
   * PUT /api/chat/conversations/:id
   */
  static async updateConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { title, model_name, system_prompt, is_pinned } = req.body;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权修改此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 如果更换模型，验证新模型
      if (model_name && model_name !== conversation.model_name) {
        const isValidModel = await AIService.validateModel(model_name);
        if (!isValidModel) {
          return ResponseHelper.validation(res, ['选择的AI模型不可用']);
        }
      }

      const updatedConversation = await conversation.update({
        title,
        model_name,
        system_prompt,
        is_pinned
      });

      logger.info('会话更新成功', { 
        userId, 
        conversationId: id 
      });

      return ResponseHelper.success(res, updatedConversation.toJSON(), '会话更新成功');
    } catch (error) {
      logger.error('会话更新失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '会话更新失败');
    }
  }

  /**
   * 删除会话
   * DELETE /api/chat/conversations/:id
   */
  static async deleteConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权删除此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      await conversation.delete();

      logger.info('会话删除成功', { 
        userId, 
        conversationId: id 
      });

      return ResponseHelper.success(res, null, '会话删除成功');
    } catch (error) {
      logger.error('会话删除失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '会话删除失败');
    }
  }

  /**
   * 获取会话消息
   * GET /api/chat/conversations/:id/messages
   */
  static async getMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 50 } = req.query;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话消息');
      }

      const result = await Message.getConversationMessages(id, {
        page: parseInt(page),
        limit: parseInt(limit),
        order: 'ASC'
      });

      return ResponseHelper.paginated(res, result.messages, result.pagination, '获取消息列表成功');
    } catch (error) {
      logger.error('获取会话消息失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取消息失败');
    }
  }

  /**
   * 发送消息并获取AI回复
   * POST /api/chat/conversations/:id/messages
   */
  static async sendMessage(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { content, file_id } = req.body;

      if (!content || content.trim().length === 0) {
        return ResponseHelper.validation(res, ['消息内容不能为空']);
      }

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权在此会话中发送消息');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 检查用户Token配额
      const user = req.user;
      const estimatedTokens = Message.estimateTokens(content);
      
      if (!user.hasTokenQuota(estimatedTokens * 2)) { // 估算请求和响应Token
        return ResponseHelper.forbidden(res, 'Token配额不足');
      }

      // 创建用户消息
      const userMessage = await Message.create({
        conversation_id: id,
        role: 'user',
        content: content.trim(),
        tokens: estimatedTokens,
        file_id
      });

      // 获取会话历史消息用于AI上下文
      const recentMessages = await Message.getRecentMessages(id, 20);
      
      // 构造AI请求消息
      const aiMessages = [];
      
      // 添加系统提示词
      if (conversation.system_prompt) {
        aiMessages.push({
          role: 'system',
          content: conversation.system_prompt
        });
      }
      
      // 添加历史消息
      recentMessages.forEach(msg => {
        aiMessages.push(msg.toAIFormat());
      });

      logger.info('发送AI请求', { 
        userId,
        conversationId: id,
        modelName: conversation.model_name,
        messageCount: aiMessages.length
      });

      // 调用AI服务
      const aiResponse = await AIService.sendMessage(
        conversation.model_name,
        aiMessages
      );

      // 创建AI回复消息
      const assistantMessage = await Message.create({
        conversation_id: id,
        role: 'assistant',
        content: aiResponse.content,
        tokens: aiResponse.usage?.completion_tokens || Message.estimateTokens(aiResponse.content)
      });

      // 更新会话统计
      const totalTokens = userMessage.tokens + assistantMessage.tokens;
      await conversation.updateStats(2, totalTokens);

      // 更新用户Token使用量
      await user.updateTokenUsage(totalTokens);

      // 如果是第一条消息且标题是默认的，自动生成标题
      if (conversation.title === 'New Chat' && conversation.message_count === 0) {
        const autoTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        await conversation.update({ title: autoTitle });
      }

      logger.info('AI对话成功', { 
        userId,
        conversationId: id,
        requestTokens: userMessage.tokens,
        responseTokens: assistantMessage.tokens,
        totalTokens
      });

      return ResponseHelper.success(res, {
        user_message: userMessage.toJSON(),
        assistant_message: assistantMessage.toJSON(),
        conversation: conversation.toJSON(),
        usage: {
          total_tokens: totalTokens,
          user_tokens: userMessage.tokens,
          assistant_tokens: assistantMessage.tokens
        }
      }, '消息发送成功');

    } catch (error) {
      logger.error('发送消息失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '消息发送失败');
    }
  }

  /**
   * 获取可用的AI模型列表
   * GET /api/chat/models
   */
  static async getModels(req, res) {
    try {
      const models = await AIService.getAvailableModels();
      
      return ResponseHelper.success(res, models, '获取AI模型列表成功');
    } catch (error) {
      logger.error('获取AI模型列表失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取AI模型列表失败');
    }
  }
}

module.exports = ChatController;
