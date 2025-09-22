/**
 * 对话控制器 - 集成积分扣减系统、动态上下文、流式输出、缓存优化、优先级排序、图片上传、文档上传、系统提示词和知识模块
 */

const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const File = require('../models/File');
const SystemPrompt = require('../models/SystemPrompt');
const ModuleCombination = require('../models/ModuleCombination');
const AIService = require('../services/aiService');
const AIStreamService = require('../services/aiStreamService');
const CacheService = require('../services/cacheService');
const StatsService = require('../services/statsService');
const User = require('../models/User');
const AIModel = require('../models/AIModel');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { ValidationError, AuthorizationError, NotFoundError } = require('../utils/errors');
const { getFileUrl } = require('../middleware/uploadMiddleware');
const { getDocumentUrl, extractContent } = require('../middleware/documentUploadMiddleware');

class ChatController {
  /**
   * 获取用户的会话列表
   * GET /api/chat/conversations
   */
  static async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      logger.info('获取用户会话列表', { userId, page, limit });

      const result = await Conversation.getUserConversations(userId, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      return ResponseHelper.paginated(res, result.conversations, result.pagination, '获取会话列表成功');
    } catch (error) {
      logger.error('获取会话列表失败', { 
        userId: req.user?.id, 
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '获取会话列表失败');
    }
  }

  /**
   * 创建新会话 - 支持上下文数量、temperature设置、优先级、系统提示词和模块组合
   * POST /api/chat/conversations
   */
  static async createConversation(req, res) {
    try {
      const userId = req.user.id;
      const { 
        title, 
        model_name, 
        system_prompt, 
        system_prompt_id, 
        module_combination_id,
        context_length, 
        ai_temperature, 
        priority 
      } = req.body;

      logger.info('开始创建会话', { 
        userId, 
        title, 
        model_name, 
        context_length,
        ai_temperature,
        priority,
        hasSystemPrompt: !!system_prompt,
        hasSystemPromptId: !!system_prompt_id,
        hasModuleCombination: !!module_combination_id
      });

      // 验证模型名称
      if (!model_name) {
        return ResponseHelper.validation(res, ['模型名称不能为空']);
      }

      // 验证AI模型是否存在且启用（使用缓存）
      const userGroupId = req.user.group_id;
      const availableModels = await CacheService.getCachedUserModels(
        userId,
        userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      
      const aiModel = availableModels.find(m => m.name === model_name);
      if (!aiModel) {
        return ResponseHelper.forbidden(res, '您无权使用该模型或模型不可用');
      }

      // 验证系统提示词（如果提供了ID）
      if (system_prompt_id) {
        const availablePrompts = await SystemPrompt.getUserAvailablePrompts(userId, userGroupId);
        const canUsePrompt = availablePrompts.some(p => p.id === system_prompt_id);
        
        if (!canUsePrompt) {
          return ResponseHelper.forbidden(res, '您无权使用该系统提示词');
        }
      }

      // 验证模块组合（如果提供了ID）
      if (module_combination_id) {
        const combination = await ModuleCombination.findById(module_combination_id, userId);
        if (!combination) {
          return ResponseHelper.notFound(res, '模块组合不存在');
        }
        
        if (combination.user_id !== userId) {
          return ResponseHelper.forbidden(res, '您无权使用该模块组合');
        }
      }

      // 验证上下文数量
      let validContextLength = parseInt(context_length) || 20;
      if (validContextLength < 0) validContextLength = 0;
      if (validContextLength > 1000) validContextLength = 1000;

      // 验证temperature参数
      let validTemperature = parseFloat(ai_temperature);
      if (isNaN(validTemperature)) validTemperature = 0.0;
      if (validTemperature < 0.0) validTemperature = 0.0;
      if (validTemperature > 1.0) validTemperature = 1.0;

      const conversationData = {
        user_id: parseInt(userId),
        title: title || 'New Chat',
        model_name: model_name || 'gpt-3.5-turbo',
        system_prompt: system_prompt || null,
        system_prompt_id: system_prompt_id || null,
        module_combination_id: module_combination_id || null,
        context_length: validContextLength,
        ai_temperature: validTemperature,
        priority: parseInt(priority) || 0
      };

      logger.info('会话数据准备完成', conversationData);

      const conversation = await Conversation.create(conversationData);

      logger.info('会话创建成功', { 
        userId, 
        conversationId: conversation.id,
        modelName: conversation.model_name,
        contextLength: conversation.context_length,
        aiTemperature: conversation.ai_temperature,
        priority: conversation.priority,
        systemPromptId: conversation.system_prompt_id,
        moduleCombinationId: conversation.module_combination_id
      });

      return ResponseHelper.success(res, conversation.toJSON(), '会话创建成功', 201);
    } catch (error) {
      logger.error('会话创建失败', { 
        userId: req.user?.id, 
        requestBody: req.body,
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, `会话创建失败: ${error.message}`);
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
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '获取会话失败');
    }
  }

  /**
   * 更新会话 - 支持上下文数量、temperature、优先级、系统提示词和模块组合更新
   * PUT /api/chat/conversations/:id
   */
  static async updateConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
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

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权修改此会话');
      }

      const conversation = await Conversation.findById(id);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 如果更换模型，验证新模型（使用缓存）
      if (model_name && model_name !== conversation.model_name) {
        const userGroupId = req.user.group_id;
        const availableModels = await CacheService.getCachedUserModels(
          userId,
          userGroupId,
          async () => await AIModel.getUserAvailableModels(userId, userGroupId)
        );
        
        const canUseModel = availableModels.some(m => m.name === model_name);
        if (!canUseModel) {
          return ResponseHelper.forbidden(res, '您无权使用该模型');
        }
      }

      // 如果更换系统提示词，验证权限
      if (system_prompt_id !== undefined && system_prompt_id !== conversation.system_prompt_id) {
        if (system_prompt_id) {
          const userGroupId = req.user.group_id;
          const availablePrompts = await SystemPrompt.getUserAvailablePrompts(userId, userGroupId);
          const canUsePrompt = availablePrompts.some(p => p.id === system_prompt_id);
          
          if (!canUsePrompt) {
            return ResponseHelper.forbidden(res, '您无权使用该系统提示词');
          }
        }
      }

      // 如果更换模块组合，验证权限
      if (module_combination_id !== undefined && module_combination_id !== conversation.module_combination_id) {
        if (module_combination_id) {
          const combination = await ModuleCombination.findById(module_combination_id, userId);
          if (!combination) {
            return ResponseHelper.notFound(res, '模块组合不存在');
          }
          
          if (combination.user_id !== userId) {
            return ResponseHelper.forbidden(res, '您无权使用该模块组合');
          }
        }
      }

      // 验证上下文数量
      let updateData = { title, model_name, system_prompt, system_prompt_id, module_combination_id, is_pinned };
      
      if (context_length !== undefined) {
        let validContextLength = parseInt(context_length) || 20;
        if (validContextLength < 0) validContextLength = 0;
        if (validContextLength > 1000) validContextLength = 1000;
        updateData.context_length = validContextLength;
      }

      // 验证temperature参数
      if (ai_temperature !== undefined) {
        let validTemperature = parseFloat(ai_temperature);
        if (isNaN(validTemperature)) validTemperature = 0.0;
        if (validTemperature < 0.0) validTemperature = 0.0;
        if (validTemperature > 1.0) validTemperature = 1.0;
        updateData.ai_temperature = validTemperature;
      }

      // 验证优先级
      if (priority !== undefined) {
        updateData.priority = parseInt(priority) || 0;
      }

      const updatedConversation = await conversation.update(updateData);

      logger.info('会话更新成功', { 
        userId, 
        conversationId: id,
        updateData
      });

      return ResponseHelper.success(res, updatedConversation.toJSON(), '会话更新成功');
    } catch (error) {
      logger.error('会话更新失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message,
        stack: error.stack
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
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '会话删除失败');
    }
  }

  /**
   * 获取会话消息
   * GET /api/chat/conversations/:id/messages
   * 修改：将默认limit从50改为1000，确保显示所有历史消息
   */
  static async getMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      // 重要修改：将默认limit从50改为1000，确保获取完整对话历史
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
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '获取消息失败');
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
   * 发送消息并获取AI回复 - 统一处理流式和非流式（支持图片、文档、系统提示词和模块组合）
   */
  static async sendMessage(req, res) {
    let creditsConsumed = 0;
    let conversationBackup = null;
    let userMessage = null;
    let aiMessageId = null;
    
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { content, file_id, stream = false } = req.body;

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

      // 获取AI模型配置（使用缓存）
      const userGroupId = req.user.group_id;
      const availableModels = await CacheService.getCachedUserModels(
        userId,
        userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      
      const aiModel = availableModels.find(m => m.name === conversation.model_name);
      if (!aiModel) {
        return ResponseHelper.forbidden(res, '您已被限制使用该模型，请创建新会话选择其他模型');
      }

      // 如果有文件，检查类型和模型支持
      let fileInfo = null;
      let documentContent = null;
      if (file_id) {
        // 验证文件所有权
        const fileOwnership = await File.checkOwnership(file_id, userId);
        if (!fileOwnership) {
          return ResponseHelper.forbidden(res, '无权使用此文件');
        }
        
        // 获取文件信息
        fileInfo = await File.findById(file_id);
        if (!fileInfo) {
          return ResponseHelper.notFound(res, '文件不存在');
        }
        
        // 判断文件类型
        const isImage = fileInfo.mime_type && fileInfo.mime_type.startsWith('image/');
        const isDocument = !isImage;
        
        if (isImage && !aiModel.image_upload_enabled) {
          return ResponseHelper.validation(res, ['当前AI模型不支持图片识别']);
        }
        
        if (isDocument && !aiModel.document_upload_enabled) {
          return ResponseHelper.validation(res, ['当前AI模型不支持文档上传']);
        }
        
        // 如果是文档，不需要提取内容，中转模型会直接读取URL
        // documentContent保持为null
      }

      // 判断是否使用流式输出
      const useStream = stream && aiModel.stream_enabled;

      const requiredCredits = aiModel.credits_per_chat || 10;
      
      // 检查用户积分余额
      const user = await User.findById(userId);
      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.forbidden(res, `积分不足，需要 ${requiredCredits} 积分，当前余额 ${user.getCredits()} 积分`);
      }

      // 检查用户Token配额
      const estimatedTokens = Message.estimateTokens(content + (documentContent || ''));
      if (!user.hasTokenQuota(estimatedTokens * 2)) {
        return ResponseHelper.forbidden(res, 'Token配额不足');
      }

      // 清除草稿（用户已发送）
      await CacheService.deleteDraft(userId, id);

      // 备份对话状态
      conversationBackup = {
        message_count: conversation.message_count,
        total_tokens: conversation.total_tokens
      };

      logger.info('预扣减积分开始', {
        userId,
        conversationId: id,
        modelName: conversation.model_name,
        useStream,
        requiredCredits,
        currentBalance: user.getCredits(),
        hasFile: !!file_id,
        isDocument: !!documentContent
      });

      // 预先扣减积分
      const creditsResult = await user.consumeCredits(
        requiredCredits, 
        aiModel.id, 
        id, 
        `AI对话消费 - ${aiModel.display_name}`
      );
      
      creditsConsumed = requiredCredits;

      // 构造实际发送的内容（如果有文档，直接附加URL）
      let actualContent = content.trim();
      if (fileInfo && !fileInfo.mime_type?.startsWith('image/')) {
        // 是文档，直接附加URL供AI访问（中转模型会自动识别）
        actualContent = `${content.trim()}\n\n${fileInfo.url}`;
      }

      // 创建用户消息（状态为completed）
      userMessage = await Message.create({
        conversation_id: id,
        role: 'user',
        content: actualContent,
        tokens: estimatedTokens,
        file_id,
        model_name: conversation.model_name,
        status: 'completed'
      });

      // 获取会话历史消息
      const recentMessages = await Message.getRecentMessages(id);
      
      // 构造AI请求消息
      const aiMessages = [];
      
      // 处理系统提示词
      let systemPromptContent = conversation.system_prompt;
      
      // 如果有系统提示词ID，获取实际内容
      if (conversation.system_prompt_id) {
        const promptContent = await SystemPrompt.getPromptContent(conversation.system_prompt_id);
        if (promptContent) {
          systemPromptContent = promptContent;
        }
      }
      
      // 如果有模块组合ID，获取组合内容
      if (conversation.module_combination_id) {
        logger.info('开始处理模块组合', {
          moduleCombinationId: conversation.module_combination_id,
          userId,
          conversationId: id
        });
        
        try {
          const combinedContent = await ModuleCombination.getCombinedContent(conversation.module_combination_id, userId);
          
          logger.info('获取模块组合内容成功', {
            moduleCombinationId: conversation.module_combination_id,
            hasSystemPrompt: !!combinedContent.systemPrompt,
            hasNormalPrompt: !!combinedContent.normalPrompt,
            systemPromptLength: combinedContent.systemPrompt?.length || 0,
            normalPromptLength: combinedContent.normalPrompt?.length || 0
          });
          
          // 如果有系统级提示词内容，添加到系统提示词
          if (combinedContent.systemPrompt) {
            systemPromptContent = systemPromptContent 
              ? `${systemPromptContent}\n\n${combinedContent.systemPrompt}`
              : combinedContent.systemPrompt;
          }
          
          // 如果有普通提示词内容，作为第一条用户消息
          if (combinedContent.normalPrompt) {
            aiMessages.push({
              role: 'user',
              content: combinedContent.normalPrompt
            });
            aiMessages.push({
              role: 'assistant',
              content: '我已经理解了上述内容，请继续提问。'
            });
          }
        } catch (error) {
          logger.error('获取模块组合内容失败', {
            moduleCombinationId: conversation.module_combination_id,
            userId,
            error: error.message,
            stack: error.stack
          });
          // 继续执行，不中断对话
        }
      }
      
      if (systemPromptContent) {
        aiMessages.push({
          role: 'system',
          content: systemPromptContent
        });
      }
      
      for (const msg of recentMessages) {
        const aiMsg = msg.toAIFormat();
        
        // 如果消息有图片，添加图片信息
        if (msg.file_id && aiModel.image_upload_enabled) {
          const file = await File.findById(msg.file_id);
          if (file && file.mime_type && file.mime_type.startsWith('image/')) {
            aiMsg.image_url = file.url;
          }
        }
        
        aiMessages.push(aiMsg);
      }

      logger.info('发送AI请求', { 
        userId,
        conversationId: id,
        modelName: conversation.model_name,
        useStream,
        messageCount: aiMessages.length,
        hasFile: !!file_id,
        hasDocument: !!documentContent,
        hasSystemPrompt: !!systemPromptContent,
        hasModuleCombination: !!conversation.module_combination_id
      });

      // 处理流式或非流式响应
      if (useStream) {
        // 流式响应处理
        aiMessageId = uuidv4();
        
        // 先创建一个状态为streaming的占位消息
        const streamingMessage = await Message.createStreamingPlaceholder({
          id: aiMessageId,
          conversation_id: id,
          role: 'assistant',
          content: '',
          tokens: 0,
          model_name: conversation.model_name
        });
        
        logger.info('创建流式消息占位符', {
          messageId: aiMessageId,
          conversationId: id,
          status: 'streaming'
        });
        
        try {
          // 准备用户消息数据，包含file信息
          const userMessageData = userMessage.toJSON();
          if (userMessageData.file_id) {
            const file = await File.findById(userMessageData.file_id);
            if (file) {
              userMessageData.file = file.toJSON();
            }
          }
          
          // 直接调用流式服务，由它来设置响应头和处理流
          await AIStreamService.sendStreamMessage(res, conversation.model_name, aiMessages, {
            temperature: conversation.getTemperature(),
            messageId: aiMessageId,
            conversationId: id,
            userId: userId,
            userMessage: userMessageData,  // 传递包含file信息的完整用户消息
            creditsInfo: {
              credits_consumed: creditsConsumed,
              credits_remaining: creditsResult.balanceAfter,
              model_credits_per_chat: requiredCredits
            },
            onComplete: async (fullContent, tokens, generatedImages) => {
              // 流式完成后更新消息状态为completed，包含生成的图片
              try {
                await Message.updateStatus(
                  aiMessageId, 
                  'completed', 
                  fullContent, 
                  tokens || Message.estimateTokens(fullContent),
                  generatedImages  // 保存生成的图片
                );

                // 更新会话统计
                const totalTokens = userMessage.tokens + (tokens || Message.estimateTokens(fullContent));
                await conversation.updateStats(2, totalTokens);
                await user.consumeTokens(totalTokens);

                // 清除消息缓存（有新消息）
                await CacheService.clearConversationCache(userId, id);

                // 更新统计数据
                await StatsService.updateUserDailyStats(userId, {
                  messages: 1,
                  tokens: totalTokens
                });
                
                // 记录模型使用
                await StatsService.recordModelUsage(conversation.model_name);

                // 如果是第一条消息且标题是默认的，自动生成标题
                if (conversation.title === 'New Chat' && conversationBackup.message_count === 0) {
                  const autoTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
                  await conversation.update({ title: autoTitle });
                }

                logger.info('流式AI对话完成', { 
                  userId,
                  conversationId: id,
                  messageId: aiMessageId,
                  totalTokens,
                  creditsConsumed,
                  modelName: conversation.model_name,
                  status: 'completed',
                  hasGeneratedImages: !!generatedImages
                });
              } catch (error) {
                logger.error('更新流式消息状态失败:', error);
                // 尝试标记为失败
                try {
                  await Message.updateStatus(aiMessageId, 'failed');
                } catch (updateError) {
                  logger.error('标记消息失败状态也失败:', updateError);
                }
              }
            }
          });
          
          // 流式响应已经由 AIStreamService 处理，这里不需要返回任何内容
          return;
          
        } catch (aiError) {
          // AI调用失败，更新消息状态为failed
          if (aiMessageId) {
            try {
              await Message.updateStatus(aiMessageId, 'failed');
            } catch (updateError) {
              logger.error('更新失败状态失败:', updateError);
            }
          }
          
          // 退还积分
          logger.error('流式AI调用失败，开始退还积分', {
            userId,
            conversationId: id,
            creditsToRefund: creditsConsumed,
            aiError: aiError.message
          });

          try {
            await user.addCredits(creditsConsumed, `流式AI调用失败退款 - ${aiError.message}`);
            logger.info('积分退还成功', { userId, creditsRefunded: creditsConsumed });
          } catch (refundError) {
            logger.error('积分退还失败', { refundError: refundError.message });
          }

          throw aiError;
        }
        
      } else {
        // 非流式响应处理 - 修改：支持图片生成
        try {
          // 生成AI消息的ID（用于图片生成服务）
          const assistantMessageId = uuidv4();
          
          const aiResponse = await AIService.sendMessage(
            conversation.model_name,
            aiMessages,
            { 
              temperature: conversation.getTemperature(),
              messageId: assistantMessageId  // 传递messageId以支持图片生成
            }
          );

          // 检查是否有生成的图片
          let generatedImages = null;
          if (aiResponse.generatedImages && aiResponse.generatedImages.length > 0) {
            generatedImages = aiResponse.generatedImages;
            logger.info('AI生成了图片', {
              conversationId: id,
              messageId: assistantMessageId,
              imageCount: generatedImages.length,
              images: generatedImages
            });
          }

          // 创建AI回复消息（状态为completed，包含生成的图片）
          const assistantMessage = await Message.create({
            id: assistantMessageId,  // 使用预生成的ID
            conversation_id: id,
            role: 'assistant',
            content: aiResponse.content,
            tokens: aiResponse.usage?.completion_tokens || Message.estimateTokens(aiResponse.content),
            model_name: conversation.model_name,
            status: 'completed',
            generated_images: generatedImages  // 保存生成的图片
          });

          // 更新会话统计
          const totalTokens = userMessage.tokens + assistantMessage.tokens;
          await conversation.updateStats(2, totalTokens);
          await user.consumeTokens(totalTokens);

          // 清除消息缓存（有新消息）
          await CacheService.clearConversationCache(userId, id);

          // 更新统计数据
          await StatsService.updateUserDailyStats(userId, {
            messages: 1,
            tokens: totalTokens
          });
          
          // 记录模型使用
          await StatsService.recordModelUsage(conversation.model_name);

          // 如果是第一条消息且标题是默认的，自动生成标题
          if (conversation.title === 'New Chat' && conversationBackup.message_count === 0) {
            const autoTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
            await conversation.update({ title: autoTitle });
          }

          logger.info('AI对话成功完成', { 
            userId,
            conversationId: id,
            totalTokens,
            creditsConsumed,
            modelName: conversation.model_name,
            hasGeneratedImages: !!generatedImages
          });

          // 处理响应中的文件信息
          const userMessageData = userMessage.toJSON();
          const assistantMessageData = assistantMessage.toJSON();
          
          if (userMessageData.file_id) {
            const file = await File.findById(userMessageData.file_id);
            if (file) {
              userMessageData.file = file.toJSON();
            }
          }

          return ResponseHelper.success(res, {
            user_message: userMessageData,
            assistant_message: assistantMessageData,
            conversation: conversation.toJSON(),
            usage: {
              total_tokens: totalTokens,
              user_tokens: userMessage.tokens,
              assistant_tokens: assistantMessage.tokens
            },
            credits_info: {
              credits_consumed: creditsConsumed,
              credits_remaining: creditsResult.balanceAfter,
              model_credits_per_chat: requiredCredits
            }
          }, 'AI对话完成');

        } catch (aiError) {
          // AI调用失败，退还积分
          logger.error('AI调用失败，开始退还积分', {
            userId,
            conversationId: id,
            creditsToRefund: creditsConsumed,
            aiError: aiError.message
          });

          try {
            await user.addCredits(creditsConsumed, `AI调用失败退款 - ${aiError.message}`);
            logger.info('积分退还成功', { userId, creditsRefunded: creditsConsumed });
          } catch (refundError) {
            logger.error('积分退还失败', { refundError: refundError.message });
          }

          throw aiError;
        }
      }

    } catch (error) {
      logger.error('发送消息失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        creditsConsumed,
        error: error.message,
        stack: error.stack
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
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '删除消息失败');
    }
  }

  /**
   * 获取可用的AI模型列表 - 根据用户权限和限制过滤（带缓存）
   * GET /api/chat/models
   */
  static async getModels(req, res) {
    try {
      // 获取用户的ID和组ID
      const userId = req.user.id;
      const userGroupId = req.user.group_id;
      
      // 使用缓存获取用户可用的模型
      const models = await CacheService.getCachedUserModels(
        userId,
        userGroupId,
        async () => await AIModel.getUserAvailableModels(userId, userGroupId)
      );
      
      // 添加积分、图片支持和文档支持信息到模型列表
      const modelsWithInfo = models.map(model => ({
        ...model,
        credits_per_chat: model.credits_per_chat || 10,
        credits_display: `${model.credits_per_chat || 10} 积分/次`,
        image_upload_enabled: !!model.image_upload_enabled,
        document_upload_enabled: !!model.document_upload_enabled
      }));
      
      logger.info('获取用户可用AI模型列表（使用缓存）', {
        userId: req.user.id,
        groupId: userGroupId,
        modelCount: modelsWithInfo.length,
        fromCache: true
      });
      
      return ResponseHelper.success(res, modelsWithInfo, '获取AI模型列表成功');
    } catch (error) {
      logger.error('获取AI模型列表失败', { 
        userId: req.user?.id, 
        error: error.message,
        stack: error.stack
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
      
      // 获取用户可用的系统提示词（不包含内容）
      const prompts = await SystemPrompt.getUserAvailablePrompts(userId, userGroupId);
      
      logger.info('获取用户可用系统提示词列表', {
        userId: req.user.id,
        groupId: userGroupId,
        promptCount: prompts.length
      });
      
      return ResponseHelper.success(res, prompts, '获取系统提示词列表成功');
    } catch (error) {
      logger.error('获取系统提示词列表失败', { 
        userId: req.user?.id, 
        error: error.message,
        stack: error.stack
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
      
      // 获取用户的模块组合列表
      const combinations = await ModuleCombination.getUserCombinations(userId, true);
      
      logger.info('获取用户模块组合列表', {
        userId: req.user.id,
        combinationCount: combinations.length
      });
      
      return ResponseHelper.success(res, combinations, '获取模块组合列表成功');
    } catch (error) {
      logger.error('获取模块组合列表失败', { 
        userId: req.user?.id, 
        error: error.message,
        stack: error.stack
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

      // 注意：这里不真正删除消息，只是设置清空时间
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
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '清空对话失败');
    }
  }
}

module.exports = ChatController;
