/**
 * 重构后的对话控制器 - 采用服务层架构
 * 控制器只负责：接收请求 -> 调用服务 -> 返回响应
 */

const ConversationService = require('../services/chat/ConversationService');
const MessageService = require('../services/chat/MessageService');
const StreamMessageService = require('../services/chat/StreamMessageService');
const NonStreamMessageService = require('../services/chat/NonStreamMessageService');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const File = require('../models/File');
const User = require('../models/User');
const AIModel = require('../models/AIModel');
const SystemPrompt = require('../models/SystemPrompt');
const ModuleCombination = require('../models/ModuleCombination');
const CacheService = require('../services/cacheService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { getFileUrl } = require('../middleware/uploadMiddleware');
const { getDocumentUrl, extractContent } = require('../middleware/documentUploadMiddleware');

class ChatControllerRefactored {
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
   * 创建新会话 - 使用ConversationService
   * POST /api/chat/conversations
   */
  static async createConversation(req, res) {
    try {
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      
      // 使用服务层准备会话数据
      const conversationData = await ConversationService.prepareConversationData({
        userId,
        userGroupId,
        ...req.body
      });

      // 创建会话
      const conversation = await Conversation.create(conversationData);

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
      return ResponseHelper.error(res, error.message || '会话创建失败');
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

      // 检查并恢复未完成的流式消息
      await Message.checkAndRecoverStreamingMessages(id);

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 检查是否有草稿
      const draft = await CacheService.getDraft(userId, id);
      const responseData = conversation.toJSON();
      if (draft) {
        responseData.draft = draft;
      }

      return ResponseHelper.success(res, responseData, '获取会话成功');
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
   * 更新会话 - 使用ConversationService验证
   * PUT /api/chat/conversations/:id
   */
  static async updateConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userGroupId = req.user.group_id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权修改此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 使用服务层验证更新权限
      await ConversationService.validateUpdatePermissions({
        conversation,
        userId,
        userGroupId,
        ...req.body
      });

      // 准备更新数据
      const { 
        title, 
        model_name, 
        system_prompt, 
        system_prompt_id, 
        module_combination_id,
        is_pinned, 
        context_length, 
        ai_temperature, 
        priority 
      } = req.body;

      let updateData = { 
        title, 
        model_name, 
        system_prompt, 
        system_prompt_id, 
        module_combination_id, 
        is_pinned 
      };
      
      if (context_length !== undefined) {
        updateData.context_length = ConversationService.validateContextLength(context_length);
      }

      if (ai_temperature !== undefined) {
        updateData.ai_temperature = ConversationService.validateTemperature(ai_temperature);
      }

      if (priority !== undefined) {
        updateData.priority = parseInt(priority) || 0;
      }

      const updatedConversation = await conversation.update(updateData);

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
      return ResponseHelper.error(res, error.message || '会话更新失败');
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

      // 清除相关缓存
      await CacheService.clearConversationCache(userId, id);

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
      const { page = 1, limit = 1000, useCache = true } = req.query;

      // 检查并恢复未完成的流式消息
      await Message.checkAndRecoverStreamingMessages(id);

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话消息');
      }

      // 尝试从缓存获取
      if (useCache !== 'false') {
        const cachedMessages = await CacheService.getCachedMessages(userId, id);
        if (cachedMessages) {
          logger.info('从缓存返回消息', { conversationId: id, count: cachedMessages.length });
          
          // 处理带图片或文档的消息
          const messagesWithFiles = await Promise.all(cachedMessages.map(async msg => {
            if (msg.file_id) {
              const file = await File.findById(msg.file_id);
              if (file) {
                msg.file = file.toJSON();
              }
            }
            return msg;
          }));
          
          return ResponseHelper.success(res, messagesWithFiles, '获取消息列表成功');
        }
      }

      // 从数据库获取
      const result = await Message.getConversationMessages(id, {
        page: parseInt(page),
        limit: parseInt(limit),
        order: 'ASC'
      });

      // 处理带图片或文档的消息
      const messagesWithFiles = await Promise.all(result.messages.map(async msg => {
        const msgData = msg.toJSON();
        if (msgData.file_id) {
          const file = await File.findById(msgData.file_id);
          if (file) {
            msgData.file = file.toJSON();
          }
        }
        return msgData;
      }));

      // 缓存消息（只缓存第一页）
      if (page == 1 && messagesWithFiles.length > 0) {
        await CacheService.cacheMessages(userId, id, messagesWithFiles);
      }

      return ResponseHelper.paginated(res, messagesWithFiles, result.pagination, '获取消息列表成功');
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
   * 发送消息并获取AI回复 - 重构版，使用服务层
   * POST /api/chat/conversations/:id/messages
   */
  static async sendMessage(req, res) {
    let creditsConsumed = 0;
    let userMessage = null;
    let aiMessageId = null;
    
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      const { content, file_id, stream = false } = req.body;

      // 1. 基础验证
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权在此会话中发送消息');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 2. 获取AI模型配置
      const availableModels = await CacheService.getCachedUserModels(
        userId,
        userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      
      const aiModel = availableModels.find(m => m.name === conversation.model_name);
      const requiredCredits = aiModel?.credits_per_chat || 10;

      // 3. 获取用户信息
      const user = await User.findById(userId);

      // 4. 使用服务层验证消息发送条件
      const { estimatedTokens } = await MessageService.validateMessageSending({
        content,
        conversation,
        aiModel,
        user,
        fileId: file_id,
        requiredCredits
      });

      // 5. 处理文件附件
      const { fileInfo } = await MessageService.processFileAttachment(file_id, userId, aiModel);

      // 6. 清除草稿
      await CacheService.deleteDraft(userId, id);

      // 7. 扣减积分
      logger.info('预扣减积分开始', {
        userId,
        conversationId: id,
        requiredCredits,
        currentBalance: user.getCredits()
      });

      const creditsResult = await user.consumeCredits(
        requiredCredits, 
        aiModel.id, 
        id, 
        `AI对话消费 - ${aiModel.display_name}`
      );
      creditsConsumed = requiredCredits;

      // 8. 创建用户消息
      const actualContent = MessageService.buildActualContent(content, fileInfo);
      userMessage = await Message.create({
        conversation_id: id,
        role: 'user',
        content: actualContent,
        tokens: estimatedTokens,
        file_id,
        model_name: conversation.model_name,
        status: 'completed'
      });

      // 9. 获取历史消息
      const recentMessages = await Message.getRecentMessages(id);
      
      // 10. 构建AI上下文 - 传递当前消息内容和文件信息
      const aiMessages = await MessageService.buildAIContext({
        conversation,
        recentMessages,
        systemPromptId: conversation.system_prompt_id,
        moduleCombinationId: conversation.module_combination_id,
        userId,
        aiModel,
        currentContent: content,  // 传递当前消息内容
        currentFileInfo: fileInfo  // 传递当前文件信息
      });

      // 11. 根据模式发送消息
      const useStream = stream && aiModel.stream_enabled;
      
      if (useStream) {
        // 流式响应
        try {
          aiMessageId = await StreamMessageService.sendStreamMessage({
            res,
            conversation,
            aiMessages,
            userMessage,
            user,
            userId,
            creditsConsumed,
            creditsResult,
            content
          });
          return; // 流式响应已处理
        } catch (error) {
          await StreamMessageService.handleStreamError({
            aiMessageId,
            user,
            creditsConsumed,
            error
          });
          throw error;
        }
      } else {
        // 非流式响应
        const responseData = await NonStreamMessageService.sendNonStreamMessage({
          conversation,
          aiMessages,
          userMessage,
          user,
          userId,
          creditsConsumed,
          creditsResult,
          content
        });
        
        return ResponseHelper.success(res, responseData, 'AI对话完成');
      }

    } catch (error) {
      logger.error('发送消息失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        creditsConsumed,
        error: error.message
      });

      // 如果还没有发送SSE响应，返回普通错误
      if (!res.headersSent) {
        return ResponseHelper.error(res, error.message || '消息发送失败');
      }
    }
  }

  /**
   * 删除消息对（用户消息和AI回复）
   * DELETE /api/chat/conversations/:id/messages/:messageId
   */
  static async deleteMessagePair(req, res) {
    try {
      const { id: conversationId, messageId } = req.params;
      const userId = req.user.id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(conversationId, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权删除此会话的消息');
      }

      // 验证消息存在
      const message = await Message.findById(messageId);
      if (!message) {
        return ResponseHelper.notFound(res, '消息不存在');
      }

      // 只能删除AI的回复消息
      if (message.role !== 'assistant') {
        return ResponseHelper.validation(res, ['只能删除AI回复消息']);
      }

      // 确保消息属于指定的会话
      if (message.conversation_id !== conversationId) {
        return ResponseHelper.forbidden(res, '消息不属于此会话');
      }

      // 删除消息对
      const result = await Message.deleteMessagePair(conversationId, messageId);

      // 清除消息缓存
      await CacheService.clearConversationCache(userId, conversationId);

      logger.info('消息对删除成功', {
        userId,
        conversationId,
        ...result
      });

      return ResponseHelper.success(res, result, '消息删除成功');
    } catch (error) {
      logger.error('删除消息对失败', {
        conversationId: req.params.id,
        messageId: req.params.messageId,
        userId: req.user?.id,
        error: error.message
      });
      return ResponseHelper.error(res, '删除消息失败');
    }
  }

  /**
   * 上传图片
   * POST /api/chat/upload-image
   */
  static async uploadImage(req, res) {
    try {
      const userId = req.user.id;
      
      if (!req.file) {
        return ResponseHelper.validation(res, ['请选择要上传的图片']);
      }
      
      const { filename, originalname, mimetype, size, path: filePath } = req.file;
      
      // 创建文件记录
      const file = await File.create({
        user_id: userId,
        filename: filename,
        original_name: originalname,
        mime_type: mimetype,
        size: size,
        path: filePath,
        url: getFileUrl(filePath)
      });
      
      logger.info('图片上传成功', {
        userId,
        fileId: file.id,
        filename
      });
      
      return ResponseHelper.success(res, file.toJSON(), '图片上传成功');
    } catch (error) {
      logger.error('图片上传失败', {
        userId: req.user?.id,
        error: error.message
      });
      return ResponseHelper.error(res, '图片上传失败');
    }
  }

  /**
   * 上传文档
   * POST /api/chat/upload-document
   */
  static async uploadDocument(req, res) {
    try {
      const userId = req.user.id;
      
      if (!req.file) {
        return ResponseHelper.validation(res, ['请选择要上传的文档']);
      }
      
      const { filename, originalname, mimetype, size, path: filePath } = req.file;
      
      // 提取文档内容（对于文本文件）
      const extractedContent = await extractContent(filePath, mimetype);
      
      // 创建文件记录
      const file = await File.create({
        user_id: userId,
        filename: filename,
        original_name: originalname,
        mime_type: mimetype,
        size: size,
        path: filePath,
        url: getDocumentUrl(filePath),
        extracted_content: extractedContent
      });
      
      logger.info('文档上传成功', {
        userId,
        fileId: file.id,
        filename,
        hasExtractedContent: !!extractedContent
      });
      
      return ResponseHelper.success(res, file.toJSON(), '文档上传成功');
    } catch (error) {
      logger.error('文档上传失败', {
        userId: req.user?.id,
        error: error.message
      });
      return ResponseHelper.error(res, '文档上传失败');
    }
  }

  /**
   * 获取可用的AI模型列表
   * GET /api/chat/models
   */
  static async getModels(req, res) {
    try {
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      
      // 使用缓存获取用户可用的模型
      const models = await CacheService.getCachedUserModels(
        userId,
        userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      
      // 添加额外信息
      const modelsWithInfo = models.map(model => ({
        ...model,
        credits_per_chat: model.credits_per_chat || 10,
        credits_display: `${model.credits_per_chat || 10} 积分/次`,
        image_upload_enabled: !!model.image_upload_enabled,
        image_generation_enabled: !!model.image_generation_enabled,
        document_upload_enabled: !!model.document_upload_enabled
      }));
      
      logger.info('获取用户可用AI模型列表', {
        userId,
        groupId: userGroupId,
        modelCount: modelsWithInfo.length
      });
      
      return ResponseHelper.success(res, modelsWithInfo, '获取AI模型列表成功');
    } catch (error) {
      logger.error('获取AI模型列表失败', { 
        userId: req.user?.id, 
        error: error.message
      });
      return ResponseHelper.error(res, '获取AI模型列表失败');
    }
  }

  /**
   * 获取可用的系统提示词列表
   * GET /api/chat/system-prompts
   */
  static async getSystemPrompts(req, res) {
    try {
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      
      const prompts = await SystemPrompt.getUserAvailablePrompts(userId, userGroupId);
      
      logger.info('获取用户可用系统提示词列表', {
        userId,
        groupId: userGroupId,
        promptCount: prompts.length
      });
      
      return ResponseHelper.success(res, prompts, '获取系统提示词列表成功');
    } catch (error) {
      logger.error('获取系统提示词列表失败', { 
        userId: req.user?.id, 
        error: error.message
      });
      return ResponseHelper.error(res, '获取系统提示词列表失败');
    }
  }

  /**
   * 获取用户的模块组合列表
   * GET /api/chat/module-combinations
   */
  static async getModuleCombinations(req, res) {
    try {
      const userId = req.user.id;
      
      const combinations = await ModuleCombination.getUserCombinations(userId, true);
      
      logger.info('获取用户模块组合列表', {
        userId,
        combinationCount: combinations.length
      });
      
      return ResponseHelper.success(res, combinations, '获取模块组合列表成功');
    } catch (error) {
      logger.error('获取模块组合列表失败', { 
        userId: req.user?.id, 
        error: error.message
      });
      return ResponseHelper.error(res, '获取模块组合列表失败');
    }
  }

  /**
   * 获取用户积分状态
   * GET /api/chat/credits
   */
  static async getUserCredits(req, res) {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);
      
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }
      
      const creditsStats = user.getCreditsStats();
      
      return ResponseHelper.success(res, {
        user_id: userId,
        credits_stats: creditsStats,
        can_chat: user.hasCredits(10)
      }, '获取用户积分状态成功');
      
    } catch (error) {
      logger.error('获取用户积分状态失败', {
        userId: req.user?.id,
        error: error.message
      });
      return ResponseHelper.error(res, '获取积分状态失败');
    }
  }

  /**
   * 保存对话草稿
   * POST /api/chat/conversations/:id/draft
   */
  static async saveDraft(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { content } = req.body;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      // 保存草稿
      const saved = await CacheService.saveDraft(userId, id, content);
      
      if (saved) {
        return ResponseHelper.success(res, { saved: true }, '草稿保存成功');
      } else {
        return ResponseHelper.success(res, { saved: false }, '草稿保存失败（Redis未连接）');
      }
    } catch (error) {
      logger.error('保存草稿失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '保存草稿失败');
    }
  }

  /**
   * 获取对话草稿
   * GET /api/chat/conversations/:id/draft
   */
  static async getDraft(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      // 获取草稿
      const draft = await CacheService.getDraft(userId, id);
      
      return ResponseHelper.success(res, { draft: draft || '' }, '获取草稿成功');
    } catch (error) {
      logger.error('获取草稿失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取草稿失败');
    }
  }

  /**
   * 删除对话草稿
   * DELETE /api/chat/conversations/:id/draft
   */
  static async deleteDraft(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      // 删除草稿
      const deleted = await CacheService.deleteDraft(userId, id);
      
      return ResponseHelper.success(res, { deleted }, '草稿删除成功');
    } catch (error) {
      logger.error('删除草稿失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '删除草稿失败');
    }
  }

  /**
   * 清空对话消息
   * POST /api/chat/conversations/:id/clear
   */
  static async clearMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权操作此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 更新会话的cleared_at时间和重置统计
      await conversation.update({
        message_count: 0,
        total_tokens: 0,
        cleared_at: new Date(),
        last_message_at: new Date()
      });

      // 清除消息缓存
      await CacheService.clearConversationCache(userId, id);

      logger.info('对话消息已清空（设置cleared_at）', { 
        userId, 
        conversationId: id,
        clearedAt: new Date()
      });

      return ResponseHelper.success(res, {
        conversationId: id,
        cleared: true
      }, '对话已清空');
    } catch (error) {
      logger.error('清空对话失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message
      });
      return ResponseHelper.error(res, '清空对话失败');
    }
  }
}

module.exports = ChatControllerRefactored;
