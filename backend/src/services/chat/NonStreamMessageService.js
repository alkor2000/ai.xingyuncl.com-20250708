/**
 * 非流式消息服务 - 处理普通消息发送的业务逻辑
 * 修复：MySQL JSON字段自动解析导致的图片数据处理问题
 */

const Message = require('../../models/Message');
const File = require('../../models/File');
const AIService = require('../aiService');
const MessageService = require('./MessageService');
const logger = require('../../utils/logger');

class NonStreamMessageService {
  /**
   * 处理非流式消息发送
   * @param {Object} params - 发送参数
   * @param {Object} params.conversation - 会话对象
   * @param {Array} params.aiMessages - AI消息数组
   * @param {Object} params.userMessage - 用户消息对象
   * @param {Object} params.user - 用户对象
   * @param {number} params.userId - 用户ID
   * @param {number} params.creditsConsumed - 消耗的积分
   * @param {Object} params.creditsResult - 积分扣减结果
   * @param {string} params.content - 消息内容
   * @returns {Object} 响应数据
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
        // 存入数据库时需要JSON字符串
        aiMessageData.generated_images = JSON.stringify(aiResponse.generatedImages);
        logger.info('AI生成了图片', {
          conversationId: conversation.id,
          imageCount: aiResponse.generatedImages.length,
          images: aiResponse.generatedImages.map(img => ({
            filename: img.filename,
            url: img.url
          }))
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

      // 准备响应数据 - 直接传递原始的 generatedImages 数组
      const responseData = await this.prepareResponseData({
        userMessage,
        assistantMessage,
        conversation,
        totalTokens,
        creditsConsumed,
        creditsResult,
        generatedImages: aiResponse.generatedImages  // 传递原始数组，避免重复解析
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
   * @param {Object} params - 响应参数
   * @param {Object} params.userMessage - 用户消息
   * @param {Object} params.assistantMessage - AI消息
   * @param {Object} params.conversation - 会话对象
   * @param {number} params.totalTokens - 总token数
   * @param {number} params.creditsConsumed - 消耗的积分
   * @param {Object} params.creditsResult - 积分结果
   * @param {Array} params.generatedImages - 生成的图片数组（可选）
   * @returns {Object} 格式化的响应数据
   */
  static async prepareResponseData(params) {
    const {
      userMessage,
      assistantMessage,
      conversation,
      totalTokens,
      creditsConsumed,
      creditsResult,
      generatedImages  // 直接从AI响应传入的原始数组
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
    
    // 🔥 修复：处理生成的图片数据
    // 优先使用直接传入的 generatedImages（避免数据库JSON字段解析问题）
    if (generatedImages && generatedImages.length > 0) {
      // 如果有直接传入的图片数组，使用它（最可靠）
      assistantMessageData.generated_images = generatedImages;
      logger.info('使用直接传入的图片数据', {
        imageCount: generatedImages.length
      });
    } else if (assistantMessageData.generated_images) {
      // 否则从数据库消息中获取
      assistantMessageData.generated_images = this.parseGeneratedImages(
        assistantMessageData.generated_images
      );
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

  /**
   * 解析生成的图片数据
   * 🔥 修复：处理MySQL JSON字段自动解析的情况
   * MySQL的JSON字段类型会被mysql2驱动自动解析为对象
   * 所以可能收到的是对象而不是字符串
   * @param {string|Array|Object} generatedImages - 图片数据
   * @returns {Array} 解析后的图片数组
   */
  static parseGeneratedImages(generatedImages) {
    if (!generatedImages) {
      return [];
    }

    // 如果已经是数组，直接返回（MySQL JSON字段被驱动自动解析的情况）
    if (Array.isArray(generatedImages)) {
      logger.info('图片数据已是数组格式', { 
        imageCount: generatedImages.length 
      });
      return generatedImages;
    }

    // 如果是字符串，尝试JSON解析（TEXT字段的情况）
    if (typeof generatedImages === 'string') {
      try {
        const parsed = JSON.parse(generatedImages);
        logger.info('成功解析图片JSON字符串', { 
          imageCount: Array.isArray(parsed) ? parsed.length : 0 
        });
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        logger.error('解析生成的图片JSON失败', { 
          error: e.message,
          dataType: typeof generatedImages,
          dataPreview: generatedImages.substring(0, 100)
        });
        return [];
      }
    }

    // 如果是其他对象类型（不太可能，但防御性处理）
    if (typeof generatedImages === 'object') {
      logger.warn('图片数据是非数组对象，尝试转换', { 
        type: typeof generatedImages,
        keys: Object.keys(generatedImages)
      });
      // 尝试将对象转为数组
      return Object.values(generatedImages);
    }

    // 其他情况返回空数组
    logger.warn('未知的图片数据格式', { 
      type: typeof generatedImages 
    });
    return [];
  }
}

module.exports = NonStreamMessageService;
