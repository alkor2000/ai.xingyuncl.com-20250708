/**
 * 流式消息服务 - 处理流式消息发送的业务逻辑
 * 
 * v2.0 变更：
 *   - prepareUserMessageData: 支持 file_ids 多文件，附加 files 数组
 * 
 * v3.0 变更：
 *   - sendStreamMessage: 从 conversation 读取 enable_thinking，传递给 AIStreamService
 *   - 支持对话级别的深度思考开关，控制是否允许模型输出推理过程
 * 
 * 修复记录：
 *   - 空内容检查，失败时标记消息并退还积分
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
   * v3.0: 读取 conversation.enable_thinking，传递给 AIStreamService
   * 
   * @param {Object} params - 发送参数
   * @returns {string} AI消息ID
   */
  static async sendStreamMessage(params) {
    const {
      res, conversation, aiMessages, userMessage,
      user, userId, creditsConsumed, creditsResult, content
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
      enableThinking: conversation.isThinkingEnabled(),
      status: 'streaming'
    });

    // 准备用户消息数据（v2.0: 包含多文件信息）
    const userMessageData = await this.prepareUserMessageData(userMessage);

    // v3.0: 读取对话的深度思考开关配置
    const enableThinking = conversation.isThinkingEnabled();

    // 调用流式服务 - v3.0: 传递 enableThinking 参数
    await AIStreamService.sendStreamMessage(res, conversation.model_name, aiMessages, {
      temperature: conversation.getTemperature(),
      enableThinking: enableThinking,  // v3.0: 是否启用深度思考
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
        aiMessageId, userMessage, conversation,
        user, userId, creditsConsumed, content
      })
    });

    return aiMessageId;
  }

  /**
   * 准备用户消息数据（包含文件信息）
   * v2.0: 支持 file_ids 多文件
   */
  static async prepareUserMessageData(userMessage) {
    const userMessageData = userMessage.toJSON();
    const allFileIds = userMessage.getAllFileIds();

    if (allFileIds.length > 0) {
      const files = await File.findByIds(allFileIds);
      userMessageData.files = files.map(f => f.toJSON());
      if (files.length > 0) {
        userMessageData.file = files[0].toJSON();
      }
      logger.info('准备用户消息文件数据', {
        messageId: userMessage.id,
        fileCount: files.length
      });
    } else if (userMessageData.file_id) {
      const file = await File.findById(userMessageData.file_id);
      if (file) {
        userMessageData.file = file.toJSON();
        userMessageData.files = [file.toJSON()];
      }
    }

    return userMessageData;
  }

  /**
   * 创建完成处理器
   * 处理流式AI响应完成后的逻辑：更新消息、统计、标题
   */
  static createCompleteHandler(params) {
    const {
      aiMessageId, userMessage, conversation,
      user, userId, creditsConsumed, content
    } = params;

    return async (fullContent, tokens, generatedImages) => {
      try {
        // 检查内容是否为空
        if (fullContent === null || fullContent === undefined || fullContent === '') {
          logger.warn('流式AI返回空内容，标记消息为失败并退还积分', {
            userId, conversationId: conversation.id,
            messageId: aiMessageId, creditsToRefund: creditsConsumed,
            modelName: conversation.model_name
          });

          await Message.updateStatus(aiMessageId, 'failed', '[AI响应为空，可能是网络问题或模型响应超时]', 0);

          await MessageService.refundCredits(
            user, creditsConsumed,
            `流式AI返回空内容退款 - 模型: ${conversation.model_name}`
          );

          logger.info('空内容处理完成：消息已标记失败，积分已退还', {
            userId, messageId: aiMessageId, creditsRefunded: creditsConsumed
          });
          return;
        }

        // 正常情况：更新消息状态
        await Message.updateStatus(
          aiMessageId, 'completed', fullContent,
          tokens || Message.estimateTokens(fullContent),
          generatedImages
        );

        // 更新统计
        await MessageService.updateStatistics({
          conversation, userMessage,
          assistantTokens: tokens || Message.estimateTokens(fullContent),
          userId, user
        });

        // 自动生成标题
        await MessageService.autoGenerateTitle(
          conversation, content, conversation.message_count
        );

        logger.info('流式AI对话完成', {
          userId, conversationId: conversation.id,
          messageId: aiMessageId, creditsConsumed,
          modelName: conversation.model_name,
          contentLength: fullContent.length,
          hasGeneratedImages: !!(generatedImages && generatedImages.length > 0)
        });
      } catch (error) {
        logger.error('更新流式消息状态失败:', error);
        try {
          await Message.updateStatus(aiMessageId, 'failed');
          logger.info('尝试退还积分（更新状态失败）', {
            userId, messageId: aiMessageId, creditsToRefund: creditsConsumed
          });
          await MessageService.refundCredits(
            user, creditsConsumed,
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

    if (aiMessageId) {
      try {
        await Message.updateStatus(aiMessageId, 'failed');
      } catch (updateError) {
        logger.error('更新失败状态失败:', updateError);
      }
    }

    logger.error('流式AI调用失败，开始退还积分', {
      userId: user.id, creditsToRefund: creditsConsumed, aiError: error.message
    });

    await MessageService.refundCredits(
      user, creditsConsumed,
      `流式AI调用失败退款 - ${error.message}`
    );
  }
}

module.exports = StreamMessageService;
