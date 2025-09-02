/**
 * 消息服务 - 处理消息发送的核心业务逻辑
 * 负责消息验证、积分管理、AI调用等
 */

const { v4: uuidv4 } = require('uuid');
const Message = require('../../models/Message');
const File = require('../../models/File');
const SystemPrompt = require('../../models/SystemPrompt');
const ModuleCombination = require('../../models/ModuleCombination');
const AIService = require('../aiService');
const AIStreamService = require('../aiStreamService');
const CacheService = require('../cacheService');
const StatsService = require('../statsService');
const logger = require('../../utils/logger');

class MessageService {
  /**
   * 验证消息发送前的所有条件
   */
  static async validateMessageSending(params) {
    const { content, conversation, aiModel, user, fileId, requiredCredits } = params;
    
    // 验证消息内容
    if (!content || content.trim().length === 0) {
      throw new Error('消息内容不能为空');
    }
    
    // 验证会话存在
    if (!conversation) {
      throw new Error('会话不存在');
    }
    
    // 验证模型可用
    if (!aiModel) {
      throw new Error('您已被限制使用该模型，请创建新会话选择其他模型');
    }
    
    // 验证积分余额
    if (!user.hasCredits(requiredCredits)) {
      throw new Error(`积分不足，需要 ${requiredCredits} 积分，当前余额 ${user.getCredits()} 积分`);
    }
    
    // 验证Token配额
    const estimatedTokens = Message.estimateTokens(content);
    if (!user.hasTokenQuota(estimatedTokens * 2)) {
      throw new Error('Token配额不足');
    }
    
    return { estimatedTokens };
  }
  
  /**
   * 处理文件附件
   */
  static async processFileAttachment(fileId, userId, aiModel) {
    if (!fileId) {
      return { fileInfo: null, documentContent: null };
    }
    
    // 验证文件所有权
    const fileOwnership = await File.checkOwnership(fileId, userId);
    if (!fileOwnership) {
      throw new Error('无权使用此文件');
    }
    
    // 获取文件信息
    const fileInfo = await File.findById(fileId);
    if (!fileInfo) {
      throw new Error('文件不存在');
    }
    
    // 判断文件类型
    const isImage = fileInfo.mime_type && fileInfo.mime_type.startsWith('image/');
    const isDocument = !isImage;
    
    if (isImage && !aiModel.image_upload_enabled) {
      throw new Error('当前AI模型不支持图片识别');
    }
    
    if (isDocument && !aiModel.document_upload_enabled) {
      throw new Error('当前AI模型不支持文档上传');
    }
    
    return { fileInfo, documentContent: null };
  }
  
  /**
   * 构建AI请求的消息上下文
   */
  static async buildAIContext(params) {
    const { conversation, recentMessages, systemPromptId, moduleCombinationId, userId, aiModel } = params;
    const aiMessages = [];
    
    // 处理系统提示词
    let systemPromptContent = conversation.system_prompt;
    
    // 如果有系统提示词ID，获取实际内容
    if (systemPromptId) {
      const promptContent = await SystemPrompt.getPromptContent(systemPromptId);
      if (promptContent) {
        systemPromptContent = promptContent;
      }
    }
    
    // 如果有模块组合ID，获取组合内容
    if (moduleCombinationId) {
      try {
        const combinedContent = await ModuleCombination.getCombinedContent(moduleCombinationId, userId);
        
        logger.info('获取模块组合内容成功', {
          moduleCombinationId,
          hasSystemPrompt: !!combinedContent.systemPrompt,
          hasNormalPrompt: !!combinedContent.normalPrompt
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
          moduleCombinationId,
          userId,
          error: error.message
        });
        // 继续执行，不中断对话
      }
    }
    
    // 添加系统提示词
    if (systemPromptContent) {
      aiMessages.push({
        role: 'system',
        content: systemPromptContent
      });
    }
    
    // 添加历史消息
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
    
    return aiMessages;
  }
  
  /**
   * 处理消息发送后的统计更新
   */
  static async updateStatistics(params) {
    const { conversation, userMessage, assistantTokens, userId, user } = params;
    
    // 更新会话统计
    const totalTokens = userMessage.tokens + assistantTokens;
    await conversation.updateStats(2, totalTokens);
    await user.consumeTokens(totalTokens);
    
    // 清除消息缓存（有新消息）
    await CacheService.clearConversationCache(userId, conversation.id);
    
    // 更新统计数据
    await StatsService.updateUserDailyStats(userId, {
      messages: 1,
      tokens: totalTokens
    });
    
    // 记录模型使用
    await StatsService.recordModelUsage(conversation.model_name);
    
    return totalTokens;
  }
  
  /**
   * 自动生成会话标题
   */
  static async autoGenerateTitle(conversation, content, messageCount) {
    if (conversation.title === 'New Chat' && messageCount === 0) {
      const autoTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      await conversation.update({ title: autoTitle });
      return autoTitle;
    }
    return null;
  }
  
  /**
   * 处理积分退款
   */
  static async refundCredits(user, credits, reason) {
    try {
      await user.addCredits(credits, reason);
      logger.info('积分退还成功', { 
        userId: user.id, 
        creditsRefunded: credits 
      });
      return true;
    } catch (error) {
      logger.error('积分退还失败', { 
        error: error.message 
      });
      return false;
    }
  }
  
  /**
   * 准备实际发送的内容
   */
  static buildActualContent(content, fileInfo) {
    let actualContent = content.trim();
    if (fileInfo && !fileInfo.mime_type?.startsWith('image/')) {
      // 是文档，直接附加URL供AI访问
      actualContent = `${content.trim()}\n\n${fileInfo.url}`;
    }
    return actualContent;
  }
}

module.exports = MessageService;
