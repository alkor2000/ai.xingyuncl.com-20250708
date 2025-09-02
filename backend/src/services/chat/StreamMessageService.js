/**
 * 流式消息服务 - 处理流式消息发送的业务逻辑
 */

const { v4: uuidv4 } = require('uuid');
const Message = require('../../models/Message');
const File = require('../../models/File');  // 添加缺失的File引用
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
        // 更新消息状态
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
          hasGeneratedImages: !!(generatedImages && generatedImages.length > 0)
        });
      } catch (error) {
        logger.error('更新流式消息状态失败:', error);
        try {
          await Message.updateStatus(aiMessageId, 'failed');
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
