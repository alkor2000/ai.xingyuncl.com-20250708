/**
 * 消息服务 - 处理消息发送的核心业务逻辑
 * 负责消息验证、积分管理、AI上下文构建等
 * 
 * v2.0 变更：
 *   - 新增 processFileAttachments(fileIds, userId, aiModel) 多文件处理方法
 *   - buildAIContext: currentFileInfo -> currentFileInfos 支持多图
 *   - 历史消息文件处理：使用 getAllFileIds() + findByIds() 支持多文件
 *   - 保留 processFileAttachment 单文件方法（向后兼容）
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
   * @param {Object} params - 验证参数
   * @param {string} params.content - 消息内容
   * @param {Object} params.conversation - 会话对象
   * @param {Object} params.aiModel - AI模型配置
   * @param {Object} params.user - 用户对象
   * @param {string} params.fileId - 文件ID（用于兼容性验证）
   * @param {number} params.requiredCredits - 所需积分
   * @returns {Object} { estimatedTokens }
   */
  static async validateMessageSending(params) {
    const { content, conversation, aiModel, user, fileId, requiredCredits } = params;
    
    if (!content || content.trim().length === 0) {
      throw new Error('消息内容不能为空');
    }
    
    if (!conversation) {
      throw new Error('会话不存在');
    }
    
    if (!aiModel) {
      throw new Error('您已被限制使用该模型，请创建新会话选择其他模型');
    }
    
    if (!user.hasCredits(requiredCredits)) {
      throw new Error(`积分不足，需要 ${requiredCredits} 积分，当前余额 ${user.getCredits()} 积分`);
    }
    
    const estimatedTokens = Message.estimateTokens(content);
    if (!user.hasTokenQuota(estimatedTokens * 2)) {
      throw new Error('Token配额不足');
    }
    
    return { estimatedTokens };
  }

  /**
   * 处理单文件附件（向后兼容方法）
   * @param {string} fileId - 文件ID
   * @param {number} userId - 用户ID
   * @param {Object} aiModel - AI模型配置
   * @returns {Object} { fileInfo, documentContent }
   */
  static async processFileAttachment(fileId, userId, aiModel) {
    if (!fileId) {
      return { fileInfo: null, documentContent: null };
    }
    
    const fileOwnership = await File.checkOwnership(fileId, userId);
    if (!fileOwnership) {
      throw new Error('无权使用此文件');
    }
    
    const fileInfo = await File.findById(fileId);
    if (!fileInfo) {
      throw new Error('文件不存在');
    }
    
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
   * v2.0 新增：处理多文件附件
   * 批量验证文件权限和类型，返回文件信息数组
   * 
   * @param {string[]} fileIds - 文件ID数组
   * @param {number} userId - 用户ID
   * @param {Object} aiModel - AI模型配置
   * @returns {Object} { fileInfos: File[] }
   */
  static async processFileAttachments(fileIds, userId, aiModel) {
    // 空数组直接返回
    if (!fileIds || fileIds.length === 0) {
      return { fileInfos: [] };
    }

    // 批量检查文件所有权
    const ownershipOk = await File.checkOwnershipBatch(fileIds, userId);
    if (!ownershipOk) {
      throw new Error('无权使用部分文件，请确认文件归属');
    }

    // 批量获取文件信息
    const fileInfos = await File.findByIds(fileIds);

    if (fileInfos.length !== fileIds.length) {
      const foundIds = new Set(fileInfos.map(f => f.id));
      const missingIds = fileIds.filter(id => !foundIds.has(id));
      logger.warn('部分文件未找到', { missingIds });
      throw new Error('部分文件不存在，请重新上传');
    }

    // 检查每个文件的类型是否被当前模型支持
    for (const fileInfo of fileInfos) {
      const isImage = fileInfo.mime_type && fileInfo.mime_type.startsWith('image/');
      const isDocument = !isImage;

      if (isImage && !aiModel.image_upload_enabled) {
        throw new Error(`当前AI模型不支持图片识别，无法发送图片: ${fileInfo.original_name}`);
      }

      if (isDocument && !aiModel.document_upload_enabled) {
        throw new Error(`当前AI模型不支持文档上传，无法发送文档: ${fileInfo.original_name}`);
      }
    }

    logger.info('多文件附件处理完成', {
      fileCount: fileInfos.length,
      imageCount: fileInfos.filter(f => f.mime_type && f.mime_type.startsWith('image/')).length,
      docCount: fileInfos.filter(f => f.mime_type && !f.mime_type.startsWith('image/')).length
    });

    return { fileInfos };
  }

  /**
   * 判断文件是否为PDF
   * @param {Object} fileInfo - 文件信息对象
   * @returns {boolean}
   */
  static isPDFFile(fileInfo) {
    if (!fileInfo) return false;
    if (fileInfo.mime_type === 'application/pdf') return true;
    if (fileInfo.original_name && fileInfo.original_name.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  /**
   * 判断文件是否为图片
   * @param {Object} fileInfo - 文件信息对象
   * @returns {boolean}
   */
  static isImageFile(fileInfo) {
    if (!fileInfo) return false;
    return fileInfo.mime_type && fileInfo.mime_type.startsWith('image/');
  }

  /**
   * 构建AI请求的消息上下文 - v2.0 增强版
   * 支持多图：currentFileInfos 数组，每个图片生成一个 image_url 项
   * 
   * @param {Object} params - 上下文参数
   * @param {Object} params.conversation - 会话对象
   * @param {Message[]} params.recentMessages - 最近的历史消息
   * @param {string} params.systemPromptId - 系统提示词ID
   * @param {string} params.moduleCombinationId - 模块组合ID
   * @param {number} params.userId - 用户ID
   * @param {Object} params.aiModel - AI模型配置
   * @param {string} params.currentContent - 当前消息文本
   * @param {File[]} [params.currentFileInfos] - v2.0: 当前消息的多文件信息数组
   * @param {File} [params.currentFileInfo] - 向后兼容: 单文件信息（如果没传currentFileInfos则使用此字段）
   * @returns {Object[]} AI消息数组
   */
  static async buildAIContext(params) {
    const {
      conversation, recentMessages, systemPromptId,
      moduleCombinationId, userId, aiModel,
      currentContent,
      currentFileInfos,   // v2.0: 多文件数组
      currentFileInfo      // 向后兼容: 单文件
    } = params;

    const aiMessages = [];

    // ---- 处理系统提示词 ----
    let systemPromptContent = conversation.system_prompt;

    if (systemPromptId) {
      const promptContent = await SystemPrompt.getPromptContent(systemPromptId);
      if (promptContent) {
        systemPromptContent = promptContent;
      }
    }

    // ---- 处理模块组合 ----
    if (moduleCombinationId) {
      try {
        const combinedContent = await ModuleCombination.getCombinedContent(moduleCombinationId, userId);

        logger.info('获取模块组合内容成功', {
          moduleCombinationId,
          hasSystemPrompt: !!combinedContent.systemPrompt,
          hasNormalPrompt: !!combinedContent.normalPrompt
        });

        if (combinedContent.systemPrompt) {
          systemPromptContent = systemPromptContent
            ? `${systemPromptContent}\n\n${combinedContent.systemPrompt}`
            : combinedContent.systemPrompt;
        }

        if (combinedContent.normalPrompt) {
          aiMessages.push({ role: 'user', content: combinedContent.normalPrompt });
          aiMessages.push({ role: 'assistant', content: '我已经理解了上述内容，请继续提问。' });
        }
      } catch (error) {
        logger.error('获取模块组合内容失败', { moduleCombinationId, userId, error: error.message });
        // 不中断对话
      }
    }

    // ---- 添加系统提示词 ----
    if (systemPromptContent) {
      aiMessages.push({ role: 'system', content: systemPromptContent });
    }

    // ---- 添加历史消息（v2.0: 支持多文件） ----
    for (const msg of recentMessages) {
      const aiMsg = msg.toAIFormat();

      // 获取消息关联的所有文件ID（兼容 file_id 和 file_ids）
      const msgFileIds = msg.getAllFileIds();

      if (msgFileIds.length > 0 && (aiModel.image_upload_enabled || aiModel.document_upload_enabled)) {
        // 批量获取文件信息
        const files = await File.findByIds(msgFileIds);

        // 分类处理：图片和PDF
        const imageUrls = [];
        let pdfFile = null;

        for (const file of files) {
          if (this.isImageFile(file)) {
            imageUrls.push(file.url);
          } else if (this.isPDFFile(file)) {
            pdfFile = file;
          }
        }

        // 设置图片URL（多图场景用数组，单图兼容用单值）
        if (imageUrls.length > 0) {
          if (imageUrls.length === 1) {
            aiMsg.image_url = imageUrls[0];
          } else {
            aiMsg.image_urls = imageUrls;   // v2.0: 多图URL数组
          }
        }

        // 设置PDF文件
        if (pdfFile) {
          aiMsg.file = { url: pdfFile.url, mime_type: pdfFile.mime_type };
        }

        logger.info('处理历史消息中的文件', {
          messageId: msg.id,
          fileCount: files.length,
          imageCount: imageUrls.length,
          hasPDF: !!pdfFile
        });
      }

      aiMessages.push(aiMsg);
    }

    // ---- 添加当前消息（v2.0: 支持多文件） ----
    if (currentContent) {
      const currentMsg = { role: 'user', content: currentContent };

      // v2.0: 优先使用 currentFileInfos 数组
      const fileInfosToProcess = currentFileInfos || (currentFileInfo ? [currentFileInfo] : []);

      if (fileInfosToProcess.length > 0) {
        const imageUrls = [];
        let pdfFile = null;

        for (const fi of fileInfosToProcess) {
          if (this.isImageFile(fi)) {
            imageUrls.push(fi.url);
          } else if (this.isPDFFile(fi)) {
            pdfFile = fi;
          }
        }

        if (imageUrls.length > 0) {
          if (imageUrls.length === 1) {
            currentMsg.image_url = imageUrls[0];
          } else {
            currentMsg.image_urls = imageUrls;
          }
        }

        if (pdfFile) {
          currentMsg.file = { url: pdfFile.url, mime_type: pdfFile.mime_type };
        }

        logger.info('处理当前消息中的文件', {
          fileCount: fileInfosToProcess.length,
          imageCount: imageUrls.length,
          hasPDF: !!pdfFile,
          imageUrls: imageUrls
        });
      }

      aiMessages.push(currentMsg);
    }

    return aiMessages;
  }

  /**
   * 处理消息发送后的统计更新
   * @param {Object} params - 统计参数
   * @returns {number} 总Token数
   */
  static async updateStatistics(params) {
    const { conversation, userMessage, assistantTokens, userId, user } = params;

    const totalTokens = userMessage.tokens + assistantTokens;
    await conversation.updateStats(2, totalTokens);
    await user.consumeTokens(totalTokens);

    await CacheService.clearConversationCache(userId, conversation.id);

    await StatsService.updateUserDailyStats(userId, {
      messages: 1,
      tokens: totalTokens
    });

    await StatsService.recordModelUsage(conversation.model_name);

    return totalTokens;
  }

  /**
   * 自动生成会话标题（首条消息时使用消息内容截断作为标题）
   * @param {Object} conversation - 会话对象
   * @param {string} content - 消息内容
   * @param {number} messageCount - 当前消息数量
   * @returns {string|null} 生成的标题，或null
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
   * @param {Object} user - 用户对象
   * @param {number} credits - 退款积分数量
   * @param {string} reason - 退款原因
   * @returns {boolean} 是否成功
   */
  static async refundCredits(user, credits, reason) {
    try {
      await user.addCredits(credits, reason);
      logger.info('积分退还成功', { userId: user.id, creditsRefunded: credits });
      return true;
    } catch (error) {
      logger.error('积分退还失败', { error: error.message });
      return false;
    }
  }

  /**
   * 准备实际发送的内容
   * PDF和图片都不需要附加URL到content中，通过专门的字段处理
   * @param {string} content - 原始消息内容
   * @param {Object} fileInfo - 文件信息（可选）
   * @returns {string} 处理后的内容
   */
  static buildActualContent(content, fileInfo) {
    return content.trim();
  }
}

module.exports = MessageService;
