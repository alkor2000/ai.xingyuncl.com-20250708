/**
 * 重构后的对话控制器 - 采用服务层架构
 * 控制器只负责：接收请求 -> 调用服务 -> 返回响应
 * 
 * v2.0 变更：
 *   - uploadImage: req.file -> req.files，返回文件数组
 *   - sendMessage: 支持 file_ids 数组参数
 *   - getMessages: 通过 _attachFilesToMessage 支持多文件展示
 *   - 新增 _attachFilesToMessage 内部方法
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

  // ================================================================
  // 会话 CRUD
  // ================================================================

  /**
   * 获取用户的会话列表
   * GET /api/chat/conversations
   */
  static async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;
      const result = await Conversation.getUserConversations(userId, { page: parseInt(page), limit: parseInt(limit) });
      return ResponseHelper.paginated(res, result.conversations, result.pagination, '获取会话列表成功');
    } catch (error) {
      logger.error('获取会话列表失败', { userId: req.user?.id, error: error.message });
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
      const userGroupId = req.user.group_id;
      const conversationData = await ConversationService.prepareConversationData({ userId, userGroupId, ...req.body });
      const conversation = await Conversation.create(conversationData);
      logger.info('会话创建成功', { userId, conversationId: conversation.id, modelName: conversation.model_name });
      return ResponseHelper.success(res, conversation.toJSON(), '会话创建成功', 201);
    } catch (error) {
      logger.error('会话创建失败', { userId: req.user?.id, error: error.message });
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
      await Message.checkAndRecoverStreamingMessages(id);
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此会话');
      const conversation = await Conversation.findById(id);
      if (!conversation) return ResponseHelper.notFound(res, '会话不存在');
      const draft = await CacheService.getDraft(userId, id);
      const responseData = conversation.toJSON();
      if (draft) responseData.draft = draft;
      return ResponseHelper.success(res, responseData, '获取会话成功');
    } catch (error) {
      logger.error('获取会话详情失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取会话失败');
    }
  }

  /**
   * 更新会话设置
   * PUT /api/chat/conversations/:id
   */
  static async updateConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权修改此会话');
      const conversation = await Conversation.findById(id);
      if (!conversation) return ResponseHelper.notFound(res, '会话不存在');
      await ConversationService.validateUpdatePermissions({ conversation, userId, userGroupId, ...req.body });

      const { title, model_name, system_prompt, system_prompt_id, module_combination_id, is_pinned, context_length, ai_temperature, priority } = req.body;
      let updateData = { title, model_name, system_prompt, system_prompt_id, module_combination_id, is_pinned };
      if (context_length !== undefined) updateData.context_length = ConversationService.validateContextLength(context_length);
      if (ai_temperature !== undefined) updateData.ai_temperature = ConversationService.validateTemperature(ai_temperature);
      if (priority !== undefined) updateData.priority = parseInt(priority) || 0;

      const updatedConversation = await conversation.update(updateData);
      logger.info('会话更新成功', { userId, conversationId: id });
      return ResponseHelper.success(res, updatedConversation.toJSON(), '会话更新成功');
    } catch (error) {
      logger.error('会话更新失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
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
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权删除此会话');
      const conversation = await Conversation.findById(id);
      if (!conversation) return ResponseHelper.notFound(res, '会话不存在');
      await conversation.delete();
      await CacheService.clearConversationCache(userId, id);
      logger.info('会话删除成功', { userId, conversationId: id });
      return ResponseHelper.success(res, null, '会话删除成功');
    } catch (error) {
      logger.error('会话删除失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '会话删除失败');
    }
  }

  // ================================================================
  // 消息相关
  // ================================================================

  /**
   * 获取会话消息列表 - v2.0: 支持 file_ids 多文件
   * GET /api/chat/conversations/:id/messages
   */
  static async getMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 1000, useCache = true } = req.query;

      await Message.checkAndRecoverStreamingMessages(id);
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此会话消息');

      // 尝试从缓存获取
      if (useCache !== 'false') {
        const cachedMessages = await CacheService.getCachedMessages(userId, id);
        if (cachedMessages) {
          logger.info('从缓存返回消息', { conversationId: id, count: cachedMessages.length });
          const messagesWithFiles = await Promise.all(
            cachedMessages.map(msg => ChatControllerRefactored._attachFilesToMessage(msg))
          );
          return ResponseHelper.success(res, messagesWithFiles, '获取消息列表成功');
        }
      }

      // 从数据库获取
      const result = await Message.getConversationMessages(id, { page: parseInt(page), limit: parseInt(limit), order: 'ASC' });

      const messagesWithFiles = await Promise.all(result.messages.map(async msg => {
        const msgData = msg.toJSON();
        return await ChatControllerRefactored._attachFilesToMessage(msgData);
      }));

      // 缓存消息（仅第一页）
      if (page == 1 && messagesWithFiles.length > 0) {
        await CacheService.cacheMessages(userId, id, messagesWithFiles);
      }

      return ResponseHelper.paginated(res, messagesWithFiles, result.pagination, '获取消息列表成功');
    } catch (error) {
      logger.error('获取会话消息失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取消息失败');
    }
  }

  /**
   * v2.0 内部方法：为消息附加文件信息（兼容 file_id 和 file_ids）
   * 为消息数据添加 file（单个，向后兼容）和 files（数组）字段
   * 
   * @param {Object} msgData - 消息JSON数据
   * @returns {Object} 附加了文件信息的消息数据
   */
  static async _attachFilesToMessage(msgData) {
    // 解析 file_ids
    let fileIds = null;
    if (msgData.file_ids) {
      fileIds = typeof msgData.file_ids === 'string' ? JSON.parse(msgData.file_ids) : msgData.file_ids;
    }

    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      // v2.0 多文件模式：批量查询
      const files = await File.findByIds(fileIds);
      msgData.files = files.map(f => f.toJSON());
      // 向后兼容：file 字段取第一个
      if (files.length > 0) {
        msgData.file = files[0].toJSON();
      }
    } else if (msgData.file_id) {
      // 向后兼容：单文件模式
      const file = await File.findById(msgData.file_id);
      if (file) {
        msgData.file = file.toJSON();
        msgData.files = [file.toJSON()];
      }
    }

    return msgData;
  }

  /**
   * 发送消息并获取AI回复 - v2.0: 支持 file_ids 多文件
   * POST /api/chat/conversations/:id/messages
   * 
   * 请求体参数：
   *   content {string} - 消息文本
   *   file_id {string} - 单文件ID（向后兼容）
   *   file_ids {string[]} - 多文件ID数组（v2.0新增，优先级高于file_id）
   *   stream {boolean} - 是否使用流式输出
   */
  static async sendMessage(req, res) {
    let creditsConsumed = 0;
    let userMessage = null;
    let aiMessageId = null;

    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      const { content, file_id, file_ids, stream = false } = req.body;

      // 1. 基础验证
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权在此会话中发送消息');

      const conversation = await Conversation.findById(id);
      if (!conversation) return ResponseHelper.notFound(res, '会话不存在');

      // 2. 获取AI模型配置
      const availableModels = await CacheService.getCachedUserModels(
        userId, userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      const aiModel = availableModels.find(m => m.name === conversation.model_name);
      const requiredCredits = aiModel?.credits_per_chat !== undefined ? aiModel.credits_per_chat : 10;

      // 3. 获取用户信息
      const user = await User.findById(userId);

      // v2.0: 统一合并 file_ids 和 file_id 为数组
      let allFileIds = [];
      if (file_ids && Array.isArray(file_ids) && file_ids.length > 0) {
        allFileIds = file_ids;
      } else if (file_id) {
        allFileIds = [file_id];
      }

      // 4. 验证消息发送条件
      const { estimatedTokens } = await MessageService.validateMessageSending({
        content, conversation, aiModel, user,
        fileId: allFileIds.length > 0 ? allFileIds[0] : null,
        requiredCredits
      });

      // 5. v2.0: 处理多文件附件（验证权限、获取文件信息）
      const { fileInfos } = await MessageService.processFileAttachments(allFileIds, userId, aiModel);

      // 6. 清除草稿
      await CacheService.deleteDraft(userId, id);

      // 7. 扣减积分
      logger.info('预扣减积分开始', {
        userId, conversationId: id, requiredCredits,
        isFreeModel: requiredCredits === 0,
        currentBalance: user.getCredits(),
        fileCount: allFileIds.length
      });

      const creditsResult = await user.consumeCredits(
        requiredCredits, aiModel.id, id,
        `AI对话消费 - ${aiModel.display_name}`
      );
      creditsConsumed = requiredCredits;

      // 8. 创建用户消息 - v2.0: 传入 file_ids
      const actualContent = MessageService.buildActualContent(content, fileInfos.length > 0 ? fileInfos[0] : null);
      userMessage = await Message.create({
        conversation_id: id,
        role: 'user',
        content: actualContent,
        tokens: estimatedTokens,
        file_id: allFileIds.length > 0 ? allFileIds[0] : null,
        file_ids: allFileIds.length > 0 ? allFileIds : null,
        model_name: conversation.model_name,
        status: 'completed'
      });

      // 9. 获取历史消息
      const recentMessages = await Message.getRecentMessages(id);

      // 10. v2.0: 构建AI上下文（传递多文件信息数组）
      const aiMessages = await MessageService.buildAIContext({
        conversation, recentMessages,
        systemPromptId: conversation.system_prompt_id,
        moduleCombinationId: conversation.module_combination_id,
        userId, aiModel,
        currentContent: content,
        currentFileInfos: fileInfos
      });

      // 11. 根据模式发送
      const useStream = stream && aiModel.stream_enabled;

      if (useStream) {
        try {
          aiMessageId = await StreamMessageService.sendStreamMessage({
            res, conversation, aiMessages, userMessage,
            user, userId, creditsConsumed, creditsResult, content
          });
          return;
        } catch (error) {
          await StreamMessageService.handleStreamError({ aiMessageId, user, creditsConsumed, error });
          throw error;
        }
      } else {
        const responseData = await NonStreamMessageService.sendNonStreamMessage({
          conversation, aiMessages, userMessage,
          user, userId, creditsConsumed, creditsResult, content
        });
        return ResponseHelper.success(res, responseData, 'AI对话完成');
      }

    } catch (error) {
      logger.error('发送消息失败', { conversationId: req.params.id, userId: req.user?.id, creditsConsumed, error: error.message });
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
      const hasAccess = await Conversation.checkOwnership(conversationId, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权删除此会话的消息');

      const message = await Message.findById(messageId);
      if (!message) return ResponseHelper.notFound(res, '消息不存在');
      if (message.role !== 'assistant') return ResponseHelper.validation(res, ['只能删除AI回复消息']);
      if (message.conversation_id !== conversationId) return ResponseHelper.forbidden(res, '消息不属于此会话');

      const result = await Message.deleteMessagePair(conversationId, messageId);
      await CacheService.clearConversationCache(userId, conversationId);
      logger.info('消息对删除成功', { userId, conversationId, ...result });
      return ResponseHelper.success(res, result, '消息删除成功');
    } catch (error) {
      logger.error('删除消息对失败', { conversationId: req.params.id, messageId: req.params.messageId, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '删除消息失败');
    }
  }

  // ================================================================
  // 文件上传
  // ================================================================

  /**
   * 上传图片 - v2.0: 支持多图上传，返回文件数组
   * POST /api/chat/upload-image
   * 中间件使用 multer.array('image', 5)，req.files 为数组
   */
  static async uploadImage(req, res) {
    try {
      const userId = req.user.id;

      // v2.0: req.files 是数组（array模式），兼容 req.file（不会触发但防御性处理）
      const files = req.files || (req.file ? [req.file] : []);

      if (files.length === 0) {
        return ResponseHelper.validation(res, ['请选择要上传的图片']);
      }

      // 批量创建文件记录
      const createdFiles = [];
      for (const file of files) {
        const { filename, originalname, mimetype, size, path: filePath } = file;
        const fileRecord = await File.create({
          user_id: userId,
          filename: filename,
          original_name: originalname,
          mime_type: mimetype,
          size: size,
          path: filePath,
          url: getFileUrl(filePath)
        });
        createdFiles.push(fileRecord.toJSON());
      }

      logger.info('图片上传成功', { userId, fileCount: createdFiles.length, fileIds: createdFiles.map(f => f.id) });

      // v2.0: 返回文件数组（前端需要适配）
      return ResponseHelper.success(res, createdFiles, `成功上传 ${createdFiles.length} 张图片`);
    } catch (error) {
      logger.error('图片上传失败', { userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '图片上传失败');
    }
  }

  /**
   * 上传文档（保持不变，仍为单文件）
   * POST /api/chat/upload-document
   */
  static async uploadDocument(req, res) {
    try {
      const userId = req.user.id;
      if (!req.file) return ResponseHelper.validation(res, ['请选择要上传的文档']);

      const { filename, originalname, mimetype, size, path: filePath } = req.file;
      const extractedContent = await extractContent(filePath, mimetype);

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

      logger.info('文档上传成功', { userId, fileId: file.id, filename, hasExtractedContent: !!extractedContent });
      return ResponseHelper.success(res, file.toJSON(), '文档上传成功');
    } catch (error) {
      logger.error('文档上传失败', { userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '文档上传失败');
    }
  }

  // ================================================================
  // 模型/提示词/模块/积分
  // ================================================================

  /**
   * 获取可用的AI模型列表
   * GET /api/chat/models
   */
  static async getModels(req, res) {
    try {
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      const models = await CacheService.getCachedUserModels(
        userId, userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      const modelsWithInfo = models.map(model => {
        const credits = model.credits_per_chat !== undefined ? model.credits_per_chat : 10;
        const isFree = credits === 0;
        return {
          ...model,
          credits_per_chat: credits,
          credits_display: isFree ? '免费' : `${credits} 积分/次`,
          is_free: isFree,
          image_upload_enabled: !!model.image_upload_enabled,
          image_generation_enabled: !!model.image_generation_enabled,
          document_upload_enabled: !!model.document_upload_enabled
        };
      });
      logger.info('获取用户可用AI模型列表', { userId, groupId: userGroupId, modelCount: modelsWithInfo.length });
      return ResponseHelper.success(res, modelsWithInfo, '获取AI模型列表成功');
    } catch (error) {
      logger.error('获取AI模型列表失败', { userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取AI模型列表失败');
    }
  }

  /** 获取系统提示词列表 - GET /api/chat/system-prompts */
  static async getSystemPrompts(req, res) {
    try {
      const prompts = await SystemPrompt.getUserAvailablePrompts(req.user.id, req.user.group_id);
      return ResponseHelper.success(res, prompts, '获取系统提示词列表成功');
    } catch (error) {
      logger.error('获取系统提示词列表失败', { userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取系统提示词列表失败');
    }
  }

  /** 获取模块组合列表 - GET /api/chat/module-combinations */
  static async getModuleCombinations(req, res) {
    try {
      const combinations = await ModuleCombination.getUserCombinations(req.user.id, true);
      return ResponseHelper.success(res, combinations, '获取模块组合列表成功');
    } catch (error) {
      logger.error('获取模块组合列表失败', { userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取模块组合列表失败');
    }
  }

  /** 获取用户积分状态 - GET /api/chat/credits */
  static async getUserCredits(req, res) {
    try {
      const user = await User.findById(req.user.id);
      if (!user) return ResponseHelper.notFound(res, '用户不存在');
      const creditsStats = user.getCreditsStats();
      return ResponseHelper.success(res, { user_id: req.user.id, credits_stats: creditsStats, can_chat: user.hasCredits(10) }, '获取用户积分状态成功');
    } catch (error) {
      logger.error('获取用户积分状态失败', { userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取积分状态失败');
    }
  }

  // ================================================================
  // 草稿管理
  // ================================================================

  /** 保存草稿 - POST /api/chat/conversations/:id/draft */
  static async saveDraft(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此会话');
      const saved = await CacheService.saveDraft(userId, id, req.body.content);
      return ResponseHelper.success(res, { saved: !!saved }, saved ? '草稿保存成功' : '草稿保存失败（Redis未连接）');
    } catch (error) {
      logger.error('保存草稿失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '保存草稿失败');
    }
  }

  /** 获取草稿 - GET /api/chat/conversations/:id/draft */
  static async getDraft(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此会话');
      const draft = await CacheService.getDraft(userId, id);
      return ResponseHelper.success(res, { draft: draft || '' }, '获取草稿成功');
    } catch (error) {
      logger.error('获取草稿失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取草稿失败');
    }
  }

  /** 删除草稿 - DELETE /api/chat/conversations/:id/draft */
  static async deleteDraft(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此会话');
      const deleted = await CacheService.deleteDraft(userId, id);
      return ResponseHelper.success(res, { deleted }, '草稿删除成功');
    } catch (error) {
      logger.error('删除草稿失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '删除草稿失败');
    }
  }

  // ================================================================
  // 清空对话
  // ================================================================

  /**
   * 清空对话消息（设置 cleared_at，不物理删除）
   * POST /api/chat/conversations/:id/clear
   */
  static async clearMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权操作此会话');

      const conversation = await Conversation.findById(id);
      if (!conversation) return ResponseHelper.notFound(res, '会话不存在');

      await conversation.update({
        message_count: 0,
        total_tokens: 0,
        cleared_at: new Date(),
        last_message_at: new Date()
      });

      await CacheService.clearConversationCache(userId, id);
      logger.info('对话消息已清空', { userId, conversationId: id, clearedAt: new Date() });
      return ResponseHelper.success(res, { conversationId: id, cleared: true }, '对话已清空');
    } catch (error) {
      logger.error('清空对话失败', { conversationId: req.params.id, userId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '清空对话失败');
    }
  }
}

module.exports = ChatControllerRefactored;
