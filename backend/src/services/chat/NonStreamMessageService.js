/**
 * 非流式消息服务 - 处理普通消息发送的业务逻辑
 * 
 * v2.0 变更：
 *   - prepareResponseData: 支持 file_ids 多文件，附加 files 数组
 * 
 * 修复记录：
 *   - MySQL JSON字段自动解析导致的图片数据处理问题
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
   * @returns {Object} 响应数据
   */
  static async sendNonStreamMessage(params) {
    const {
      conversation, aiMessages, userMessage,
      user, userId, creditsConsumed, creditsResult, content
    } = params;

    try {
      // 调用AI服务
      const aiResponse = await AIService.sendMessage(
        conversation.model_name, aiMessages,
        { temperature: conversation.getTemperature(), messageId: userMessage.id }
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

      // 如果有生成的图片
      if (aiResponse.generatedImages && aiResponse.generatedImages.length > 0) {
        aiMessageData.generated_images = JSON.stringify(aiResponse.generatedImages);
        logger.info('AI生成了图片', {
          conversationId: conversation.id,
          imageCount: aiResponse.generatedImages.length
        });
      }

      // 创建AI回复消息
      const assistantMessage = await Message.create(aiMessageData);

      // 更新统计
      const totalTokens = await MessageService.updateStatistics({
        conversation, userMessage,
        assistantTokens: assistantMessage.tokens,
        userId, user
      });

      // 自动生成标题
      await MessageService.autoGenerateTitle(conversation, content, conversation.message_count);

      logger.info('AI对话成功完成', {
        userId, conversationId: conversation.id,
        totalTokens, creditsConsumed, modelName: conversation.model_name,
        hasGeneratedImages: !!(aiResponse.generatedImages && aiResponse.generatedImages.length > 0)
      });

      // 准备响应数据
      const responseData = await this.prepareResponseData({
        userMessage, assistantMessage, conversation,
        totalTokens, creditsConsumed, creditsResult,
        generatedImages: aiResponse.generatedImages
      });

      return responseData;

    } catch (aiError) {
      // AI调用失败，退还积分
      logger.error('AI调用失败，开始退还积分', {
        userId, conversationId: conversation.id,
        creditsToRefund: creditsConsumed, aiError: aiError.message
      });

      await MessageService.refundCredits(
        user, creditsConsumed,
        `AI调用失败退款 - ${aiError.message}`
      );

      throw aiError;
    }
  }

  /**
   * 准备响应数据 - v2.0: 支持多文件
   * @param {Object} params - 响应参数
   * @returns {Object} 格式化的响应数据
   */
  static async prepareResponseData(params) {
    const {
      userMessage, assistantMessage, conversation,
      totalTokens, creditsConsumed, creditsResult,
      generatedImages
    } = params;

    // 处理用户消息的文件信息 - v2.0: 支持多文件
    const userMessageData = userMessage.toJSON();
    const allFileIds = userMessage.getAllFileIds();

    if (allFileIds.length > 0) {
      // v2.0: 批量查询文件信息
      const files = await File.findByIds(allFileIds);
      userMessageData.files = files.map(f => f.toJSON());
      if (files.length > 0) {
        userMessageData.file = files[0].toJSON();
      }
    } else if (userMessageData.file_id) {
      // 向后兼容
      const file = await File.findById(userMessageData.file_id);
      if (file) {
        userMessageData.file = file.toJSON();
        userMessageData.files = [file.toJSON()];
      }
    }

    // 处理AI消息数据
    const assistantMessageData = assistantMessage.toJSON();

    // 处理生成的图片数据
    if (generatedImages && generatedImages.length > 0) {
      assistantMessageData.generated_images = generatedImages;
    } else if (assistantMessageData.generated_images) {
      assistantMessageData.generated_images = this.parseGeneratedImages(assistantMessageData.generated_images);
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
   * 处理 MySQL JSON 字段可能被自动解析为对象的情况
   * @param {string|Array|Object} generatedImages - 图片数据
   * @returns {Array} 解析后的图片数组
   */
  static parseGeneratedImages(generatedImages) {
    if (!generatedImages) return [];

    // 已经是数组（MySQL JSON字段被驱动自动解析）
    if (Array.isArray(generatedImages)) return generatedImages;

    // 字符串：尝试JSON解析
    if (typeof generatedImages === 'string') {
      try {
        const parsed = JSON.parse(generatedImages);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        logger.error('解析生成的图片JSON失败', { error: e.message });
        return [];
      }
    }

    // 其他对象类型
    if (typeof generatedImages === 'object') {
      return Object.values(generatedImages);
    }

    return [];
  }
}

module.exports = NonStreamMessageService;
