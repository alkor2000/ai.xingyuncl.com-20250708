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
   * 判断文件是否为PDF
   */
  static isPDFFile(fileInfo) {
    if (!fileInfo) return false;
    
    // 通过MIME类型判断
    if (fileInfo.mime_type === 'application/pdf') {
      return true;
    }
    
    // 通过文件名判断（作为备选）
    if (fileInfo.original_name && fileInfo.original_name.toLowerCase().endsWith('.pdf')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 判断文件是否为图片
   */
  static isImageFile(fileInfo) {
    if (!fileInfo) return false;
    return fileInfo.mime_type && fileInfo.mime_type.startsWith('image/');
  }
  
  /**
   * 构建AI请求的消息上下文 - 增强版，支持PDF
   */
  static async buildAIContext(params) {
    const { conversation, recentMessages, systemPromptId, moduleCombinationId, userId, aiModel, currentContent, currentFileInfo } = params;
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
      
      // 处理历史消息中的文件
      if (msg.file_id && (aiModel.image_upload_enabled || aiModel.document_upload_enabled)) {
        const file = await File.findById(msg.file_id);
        if (file) {
          // 判断文件类型
          if (this.isImageFile(file)) {
            // 图片使用image_url
            aiMsg.image_url = file.url;
          } else if (this.isPDFFile(file)) {
            // PDF使用file格式（OpenRouter格式）
            aiMsg.file = {
              url: file.url,
              mime_type: file.mime_type
            };
          }
          
          logger.info('处理历史消息中的文件', {
            messageId: msg.id,
            fileId: msg.file_id,
            fileType: this.isImageFile(file) ? 'image' : (this.isPDFFile(file) ? 'pdf' : 'document'),
            mimeType: file.mime_type
          });
        }
      }
      
      aiMessages.push(aiMsg);
    }
    
    // 添加当前消息（需要在调用处单独处理）
    if (currentContent) {
      const currentMsg = {
        role: 'user',
        content: currentContent
      };
      
      // 处理当前消息的文件
      if (currentFileInfo) {
        if (this.isImageFile(currentFileInfo)) {
          currentMsg.image_url = currentFileInfo.url;
        } else if (this.isPDFFile(currentFileInfo)) {
          currentMsg.file = {
            url: currentFileInfo.url,
            mime_type: currentFileInfo.mime_type
          };
        }
        
        logger.info('处理当前消息中的文件', {
          fileType: this.isImageFile(currentFileInfo) ? 'image' : (this.isPDFFile(currentFileInfo) ? 'pdf' : 'document'),
          mimeType: currentFileInfo.mime_type,
          url: currentFileInfo.url
        });
      }
      
      aiMessages.push(currentMsg);
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
   * 注意：对于PDF文件，不再附加URL到content中，而是使用专门的file字段
   */
  static buildActualContent(content, fileInfo) {
    // PDF和图片都不需要附加URL到content中
    // OpenRouter会通过专门的字段处理文件
    return content.trim();
  }
}

module.exports = MessageService;
