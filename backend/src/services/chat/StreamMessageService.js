/**
 * 流式消息服务 - 处理流式消息发送的业务逻辑
 * 修复：空内容检查，失败时标记消息并退还积分
 */

const { v4: uuidv4 } = require('uuid');
const Message = require('../../models/Message');
const File = require('../../models/File');
const AIStreamService = require('../aiStreamService');
const MessageService = require('./MessageService');
const logger = require('../../utils/logger');

class StreamMessageService {
  /**
   * 处理流式消息发送
   */
  static async sendStreamMessage(params) {
    const {
      res,
      conversation,
      aiMessages,
      userMessage,
      user,
      userId,
      creditsConsumed,
      creditsResult,
      content
    } = params;
    
    const aiMessageId = uuidv4();
    
    // 创建流式消息占位符
    await Message.createStreamingPlaceholder({
      id: aiMessageId,
      conversation_id: conversation.id,
      role: 'assistant',
      content: '',
      tokens: 0,
      model_name: conversation.model_name
    });
    
    logger.info('创建流式消息占位符', {
      messageId: aiMessageId,
      conversationId: conversation.id,
      status: 'streaming'
    });
    
    // 准备用户消息数据
    const userMessageData = await this.prepareUserMessageData(userMessage);
    
    // 调用流式服务
    await AIStreamService.sendStreamMessage(res, conversation.model_name, aiMessages, {
      temperature: conversation.getTemperature(),
      messageId: aiMessageId,
      conversationId: conversation.id,
      userId: userId,
      userMessage: userMessageData,
      creditsInfo: {
        credits_consumed: creditsConsumed,
        credits_remaining: creditsResult.balanceAfter,
        model_credits_per_chat: creditsConsumed
      },
      onComplete: this.createCompleteHandler({
        aiMessageId,
        userMessage,
        conversation,
        user,
        userId,
        creditsConsumed,
        content
      })
    });
    
    return aiMessageId;
  }
  
  /**
   * 准备用户消息数据（包含文件信息）
   */
  static async prepareUserMessageData(userMessage) {
    const userMessageData = userMessage.toJSON();
    if (userMessageData.file_id) {
      const file = await File.findById(userMessageData.file_id);
      if (file) {
        userMessageData.file = file.toJSON();
      }
    }
    return userMessageData;
  }
  
  /**
   * 创建完成处理器
   * 修复：检查空内容，失败时标记消息并退还积分
   */
  static createCompleteHandler(params) {
    const {
      aiMessageId,
      userMessage,
      conversation,
      user,
      userId,
      creditsConsumed,
      content
    } = params;
    
    return async (fullContent, tokens, generatedImages) => {
      try {
        // 修复：检查内容是否为空（null表示失败）
        if (fullContent === null || fullContent === undefined || fullContent === '') {
          logger.warn('流式AI返回空内容，标记消息为失败并退还积分', {
            userId,
            conversationId: conversation.id,
            messageId: aiMessageId,
            creditsToRefund: creditsConsumed,
            modelName: conversation.model_name
          });
          
          // 标记消息为失败
          await Message.updateStatus(aiMessageId, 'failed', '[AI响应为空，可能是网络问题或模型响应超时]', 0);
          
          // 退还积分
          await MessageService.refundCredits(
            user,
            creditsConsumed,
            `流式AI返回空内容退款 - 模型: ${conversation.model_name}`
          );
          
          logger.info('空内容处理完成：消息已标记失败，积分已退还', {
            userId,
            messageId: aiMessageId,
            creditsRefunded: creditsConsumed
          });
          
          return;
        }
        
        // 正常情况：更新消息状态
        await Message.updateStatus(
          aiMessageId, 
          'completed', 
          fullContent, 
          tokens || Message.estimateTokens(fullContent),
          generatedImages
        );

        // 更新统计
        await MessageService.updateStatistics({
          conversation,
          userMessage,
          assistantTokens: tokens || Message.estimateTokens(fullContent),
          userId,
          user
        });

        // 自动生成标题
        const conversationBackup = {
          message_count: conversation.message_count
        };
        await MessageService.autoGenerateTitle(
          conversation, 
          content, 
          conversationBackup.message_count
        );

        logger.info('流式AI对话完成', { 
          userId,
          conversationId: conversation.id,
          messageId: aiMessageId,
          creditsConsumed,
          modelName: conversation.model_name,
          status: 'completed',
          contentLength: fullContent.length,
          hasGeneratedImages: !!(generatedImages && generatedImages.length > 0)
        });
      } catch (error) {
        logger.error('更新流式消息状态失败:', error);
        try {
          await Message.updateStatus(aiMessageId, 'failed');
          
          // 更新失败也要尝试退还积分
          logger.info('尝试退还积分（更新状态失败）', {
            userId,
            messageId: aiMessageId,
            creditsToRefund: creditsConsumed
          });
          
          await MessageService.refundCredits(
            user,
            creditsConsumed,
            `流式AI处理异常退款 - ${error.message}`
          );
        } catch (updateError) {
          logger.error('标记消息失败状态也失败:', updateError);
        }
      }
    };
  }
  
  /**
   * 处理流式消息失败
   */
  static async handleStreamError(params) {
    const { aiMessageId, user, creditsConsumed, error } = params;
    
    // 更新消息状态为失败
    if (aiMessageId) {
      try {
        await Message.updateStatus(aiMessageId, 'failed');
      } catch (updateError) {
        logger.error('更新失败状态失败:', updateError);
      }
    }
    
    // 退还积分
    logger.error('流式AI调用失败，开始退还积分', {
      userId: user.id,
      creditsToRefund: creditsConsumed,
      aiError: error.message
    });
    
    await MessageService.refundCredits(
      user, 
      creditsConsumed, 
      `流式AI调用失败退款 - ${error.message}`
    );
  }
}

module.exports = StreamMessageService;
