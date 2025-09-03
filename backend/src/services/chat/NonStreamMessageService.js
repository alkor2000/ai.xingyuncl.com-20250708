/**
 * 非流式消息服务 - 处理普通消息发送的业务逻辑
 */

const Message = require('../../models/Message');
const File = require('../../models/File');
const AIService = require('../aiService');
const MessageService = require('./MessageService');
const logger = require('../../utils/logger');

class NonStreamMessageService {
  /**
   * 处理非流式消息发送
   */
  static async sendNonStreamMessage(params) {
    const {
      conversation,
      aiMessages,
      userMessage,
      user,
      userId,
      creditsConsumed,
      creditsResult,
      content
    } = params;
    
    try {
      // 调用AI服务 - 传递messageId以支持图片生成
      const aiResponse = await AIService.sendMessage(
        conversation.model_name,
        aiMessages,
        { 
          temperature: conversation.getTemperature(),
          messageId: userMessage.id  // 传递消息ID用于保存生成的图片
        }
      );

      // 准备AI消息数据
      const aiMessageData = {
        conversation_id: conversation.id,
        role: 'assistant',
        content: aiResponse.content,
        tokens: aiResponse.usage?.completion_tokens || Message.estimateTokens(aiResponse.content),
        model_name: conversation.model_name,
        status: 'completed'
      };

      // 如果有生成的图片，添加到消息中
      if (aiResponse.generatedImages && aiResponse.generatedImages.length > 0) {
        aiMessageData.generated_images = JSON.stringify(aiResponse.generatedImages);
        logger.info('AI生成了图片', {
          conversationId: conversation.id,
          imageCount: aiResponse.generatedImages.length,
          images: aiResponse.generatedImages
        });
      }

      // 创建AI回复消息
      const assistantMessage = await Message.create(aiMessageData);

      // 更新统计
      const totalTokens = await MessageService.updateStatistics({
        conversation,
        userMessage,
        assistantTokens: assistantMessage.tokens,
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

      logger.info('AI对话成功完成', { 
        userId,
        conversationId: conversation.id,
        totalTokens,
        creditsConsumed,
        modelName: conversation.model_name,
        hasGeneratedImages: !!(aiResponse.generatedImages && aiResponse.generatedImages.length > 0)
      });

      // 准备响应数据
      const responseData = await this.prepareResponseData({
        userMessage,
        assistantMessage,
        conversation,
        totalTokens,
        creditsConsumed,
        creditsResult,
        generatedImages: aiResponse.generatedImages
      });

      return responseData;
      
    } catch (aiError) {
      // AI调用失败，退还积分
      logger.error('AI调用失败，开始退还积分', {
        userId,
        conversationId: conversation.id,
        creditsToRefund: creditsConsumed,
        aiError: aiError.message
      });

      await MessageService.refundCredits(
        user, 
        creditsConsumed, 
        `AI调用失败退款 - ${aiError.message}`
      );

      throw aiError;
    }
  }
  
  /**
   * 准备响应数据
   */
  static async prepareResponseData(params) {
    const {
      userMessage,
      assistantMessage,
      conversation,
      totalTokens,
      creditsConsumed,
      creditsResult,
      generatedImages
    } = params;
    
    // 处理用户消息的文件信息
    const userMessageData = userMessage.toJSON();
    if (userMessageData.file_id) {
      const file = await File.findById(userMessageData.file_id);
      if (file) {
        userMessageData.file = file.toJSON();
      }
    }
    
    // 处理AI消息数据
    const assistantMessageData = assistantMessage.toJSON();
    
    // 如果有生成的图片，解析JSON字符串
    if (assistantMessageData.generated_images) {
      try {
        assistantMessageData.generated_images = JSON.parse(assistantMessageData.generated_images);
      } catch (e) {
        logger.error('解析生成的图片JSON失败', { error: e.message });
        assistantMessageData.generated_images = [];
      }
    }
    
    return {
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
        model_credits_per_chat: creditsConsumed
      }
    };
  }
}

module.exports = NonStreamMessageService;
