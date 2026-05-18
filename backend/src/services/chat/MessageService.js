/**
 * 消息服务 - 处理消息发送的核心业务逻辑
 * 负责消息验证、积分管理、AI上下文构建等
 * 
 * v2.0：processFileAttachments 多文件处理 + buildAIContext 多图支持
 * v2.1：PDF 文件附加 file_path 和 mime_type 给 AI 服务层做 base64 编码
 * v3.0：实现"PDF 最后一次出现保留"算法（首版有缺陷，见下方 v3.1）
 * 
 * v3.1 变更（2026-05-18 算法修正）：
 *   核心问题：v3.0 算法只看消息位置，导致"第 1 轮上传，第 2/3 轮不传"场景下，
 *            PDF 在第 2/3 轮仍被完整加载（因为它在第 1 轮是"最后一次出现"）。
 *   
 *   正确算法（业界标准 - ChatGPT/Claude 实际做法）：
 *   - 优先级 1：用户"本轮"显式新上传的 PDF → 完整加载
 *   - 优先级 2：本轮没传新 PDF 时，找历史中"最近一次"带 PDF 的消息 → 完整加载
 *   - 其余所有历史 PDF → 文本引用
 *   
 *   附加修复：
 *   - 消除 recentMessages 与 currentContent 的重复处理
 *     （刚创建的 user 消息已在 recentMessages 中，不应再作为"当前消息"处理）
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
   * 处理单文件附件（向后兼容）
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
   * 处理多文件附件
   */
  static async processFileAttachments(fileIds, userId, aiModel) {
    if (!fileIds || fileIds.length === 0) {
      return { fileInfos: [] };
    }

    const ownershipOk = await File.checkOwnershipBatch(fileIds, userId);
    if (!ownershipOk) {
      throw new Error('无权使用部分文件，请确认文件归属');
    }

    const fileInfos = await File.findByIds(fileIds);

    if (fileInfos.length !== fileIds.length) {
      const foundIds = new Set(fileInfos.map(f => f.id));
      const missingIds = fileIds.filter(id => !foundIds.has(id));
      logger.warn('部分文件未找到', { missingIds });
      throw new Error('部分文件不存在，请重新上传');
    }

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

  /** 判断文件是否为PDF */
  static isPDFFile(fileInfo) {
    if (!fileInfo) return false;
    if (fileInfo.mime_type === 'application/pdf') return true;
    if (fileInfo.original_name && fileInfo.original_name.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  /** 判断文件是否为图片 */
  static isImageFile(fileInfo) {
    if (!fileInfo) return false;
    return fileInfo.mime_type && fileInfo.mime_type.startsWith('image/');
  }

  /**
   * v3.1 重写：构建消息文件附件计划
   * 
   * 算法（业界标准做法）：
   *   1. 从后往前遍历所有消息
   *   2. 找到第一个（最近的）含 PDF 的 user 消息 → 标记其 PDF 为"完整加载"
   *   3. 该消息之前的所有 PDF → 标记为"文本引用"
   *   4. 该消息中的其他 PDF（如果一条消息有多个 PDF）也是"完整加载"
   *   5. 图片：每条消息中的图片始终保留（图片本身较小，模型每次都需要看到）
   * 
   * 直观理解：
   *   - 用户最近一次上传 PDF 的那一轮 = 最相关的文档讨论
   *   - 之前轮次的 PDF，依靠 AI 在那些轮次中的回复（已总结）来回忆
   *   - 模型记得"曾经看过哪些文件"，且能从历史回复中找到相关信息
   * 
   * @param {Array} allMessages - 完整消息列表（按时间顺序）
   *                              每项格式：{ role, content, fileInfos: File[] }
   * @returns {Map} 消息索引 -> { pdfFullLoad: File[], pdfTextRef: File[], images: File[] }
   */
  static _buildFileAttachmentPlan(allMessages) {
    const plan = new Map();

    // 步骤 1：从后往前找"最近一条含 PDF 的 user 消息"的索引
    let latestPdfMsgIndex = -1;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (msg.role !== 'user') continue;
      const hasPdf = (msg.fileInfos || []).some(f => this.isPDFFile(f));
      if (hasPdf) {
        latestPdfMsgIndex = i;
        break;
      }
    }

    // 步骤 2：构建每条消息的附件计划
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      const fileInfos = msg.fileInfos || [];

      const pdfFullLoad = [];
      const pdfTextRef = [];
      const images = [];

      for (const file of fileInfos) {
        if (this.isImageFile(file)) {
          // 图片始终保留（不参与 PDF 优化）
          images.push(file);
        } else if (this.isPDFFile(file)) {
          if (i === latestPdfMsgIndex) {
            // 这是"最近一条含 PDF 的 user 消息"，PDF 完整加载
            pdfFullLoad.push(file);
          } else {
            // 其他位置的所有 PDF 都退化为文本引用
            pdfTextRef.push(file);
          }
        }
      }

      plan.set(i, { pdfFullLoad, pdfTextRef, images });
    }

    logger.info('PDF附件计划构建', {
      totalMessages: allMessages.length,
      latestPdfMsgIndex,
      strategy: 'latest-pdf-message-full-load'
    });

    return plan;
  }

  /**
   * 根据附件计划构建消息的 file 字段
   */
  static _buildMessageAttachments(attachPlan) {
    const imageUrls = attachPlan.images.map(img => img.url);

    let primaryPdf = null;
    if (attachPlan.pdfFullLoad.length > 0) {
      const pdf = attachPlan.pdfFullLoad[0];
      primaryPdf = {
        url: pdf.url,
        file_path: pdf.file_path,
        mime_type: pdf.mime_type,
        original_name: pdf.original_name
      };

      if (attachPlan.pdfFullLoad.length > 1) {
        logger.warn('单条消息中有多个待完整加载 PDF，仅第一个完整加载', {
          totalCount: attachPlan.pdfFullLoad.length,
          loadedFile: pdf.original_name,
          otherFiles: attachPlan.pdfFullLoad.slice(1).map(f => f.original_name)
        });
      }
    }

    const textPdfRefs = [
      ...attachPlan.pdfTextRef,
      ...attachPlan.pdfFullLoad.slice(1)
    ].map(pdf => pdf.original_name || '未命名文件');

    return { imageUrls, primaryPdf, textPdfRefs };
  }

  /**
   * 构建AI请求的消息上下文 - v3.1 修复版
   * 
   * 关键修复：
   *   1. 不再重复处理"当前消息"。Controller 调用前已经把 user 消息存入数据库，
   *      它已经在 recentMessages 里。currentContent/currentFileInfos 仅作"健壮性兜底"。
   *   2. 采用"最近一次含 PDF 的 user 消息完整加载"的正确算法。
   */
  static async buildAIContext(params) {
    const {
      conversation, recentMessages, systemPromptId,
      moduleCombinationId, userId, aiModel,
      currentContent,
      currentFileInfos,
      currentFileInfo
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
      }
    }

    // ---- 添加系统提示词 ----
    if (systemPromptContent) {
      aiMessages.push({ role: 'system', content: systemPromptContent });
    }

    // ============================================================
    // v3.1 核心：避免重复处理 + 正确的 PDF 算法
    // ============================================================

    // 检查 recentMessages 是否已经包含"当前消息"
    // 判断依据：最后一条 user 消息的内容是否与 currentContent 相同
    let needAppendCurrentMessage = !!currentContent;

    if (needAppendCurrentMessage && recentMessages.length > 0) {
      const lastMsg = recentMessages[recentMessages.length - 1];
      if (lastMsg.role === 'user' && lastMsg.content === currentContent) {
        needAppendCurrentMessage = false;
        logger.info('检测到 currentContent 已存在于 recentMessages 末尾，跳过重复添加', {
          lastMsgId: lastMsg.id
        });
      }
    }

    // 批量收集所有需要处理的消息引用的文件 ID
    const allFileIds = new Set();
    for (const msg of recentMessages) {
      const ids = msg.getAllFileIds();
      ids.forEach(id => allFileIds.add(id));
    }

    // 当前消息的文件（如果需要附加）
    const currentFileInfosToProcess = currentFileInfos || (currentFileInfo ? [currentFileInfo] : []);

    // 批量查询所有文件信息
    const allFileIdsArr = Array.from(allFileIds);
    const fileInfoMap = new Map();

    if (allFileIdsArr.length > 0 && (aiModel.image_upload_enabled || aiModel.document_upload_enabled)) {
      const allFiles = await File.findByIds(allFileIdsArr);
      for (const f of allFiles) {
        fileInfoMap.set(f.id, f);
      }
    }

    // 构建"完整消息列表"用于附件计划
    const allMessagesForPlan = recentMessages.map(msg => {
      const ids = msg.getAllFileIds();
      const fileInfos = ids
        .map(id => fileInfoMap.get(id))
        .filter(Boolean);

      return { role: msg.role, content: msg.content, fileInfos, _msgObj: msg };
    });

    // 仅当 recentMessages 中不包含当前消息时，才追加（容错兜底）
    if (needAppendCurrentMessage) {
      logger.warn('当前消息未在 recentMessages 中，作为兜底追加', {
        contentPreview: currentContent.substring(0, 30),
        currentFileCount: currentFileInfosToProcess.length
      });
      allMessagesForPlan.push({
        role: 'user',
        content: currentContent,
        fileInfos: currentFileInfosToProcess,
        _isCurrent: true
      });
    }

    // 运行"最近一次含 PDF 的 user 消息完整加载"算法
    const attachmentPlan = this._buildFileAttachmentPlan(allMessagesForPlan);

    // 根据计划构建 AI 消息
    let totalPdfFullLoad = 0;
    let totalPdfTextRef = 0;
    let totalImages = 0;

    for (let i = 0; i < allMessagesForPlan.length; i++) {
      const planMsg = allMessagesForPlan[i];
      const isCurrent = !!planMsg._isCurrent;

      let aiMsg;
      if (isCurrent) {
        aiMsg = { role: planMsg.role, content: planMsg.content };
      } else {
        aiMsg = planMsg._msgObj.toAIFormat();
      }

      const attachPlan = attachmentPlan.get(i) || { pdfFullLoad: [], pdfTextRef: [], images: [] };
      const { imageUrls, primaryPdf, textPdfRefs } = this._buildMessageAttachments(attachPlan);

      // 应用图片
      if (imageUrls.length > 0) {
        if (imageUrls.length === 1) {
          aiMsg.image_url = imageUrls[0];
        } else {
          aiMsg.image_urls = imageUrls;
        }
        totalImages += imageUrls.length;
      }

      // 应用 PDF 完整加载
      if (primaryPdf) {
        aiMsg.file = primaryPdf;
        totalPdfFullLoad++;
      }

      // 应用 PDF 文本引用
      if (textPdfRefs.length > 0) {
        const refsText = textPdfRefs.map(name => `"${name}"`).join('、');
        const refHint = `\n\n[此前对话中已上传过的文件: ${refsText}（请参考上文已提及的内容）]`;

        if (typeof aiMsg.content === 'string') {
          aiMsg.content = aiMsg.content + refHint;
        } else if (Array.isArray(aiMsg.content)) {
          const firstText = aiMsg.content.find(b => b.type === 'text');
          if (firstText) {
            firstText.text = firstText.text + refHint;
          } else {
            aiMsg.content.unshift({ type: 'text', text: refHint.trim() });
          }
        }
        totalPdfTextRef += textPdfRefs.length;
      }

      aiMessages.push(aiMsg);
    }

    logger.info('PDF多轮对话优化：附件分配完成', {
      totalMessages: allMessagesForPlan.length,
      pdfFullLoadCount: totalPdfFullLoad,
      pdfTextRefCount: totalPdfTextRef,
      imageCount: totalImages,
      strategy: 'latest-pdf-message-full-load',
      appendedCurrent: needAppendCurrentMessage
    });

    return aiMessages;
  }

  /**
   * 处理消息发送后的统计更新
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
      logger.info('积分退还成功', { userId: user.id, creditsRefunded: credits });
      return true;
    } catch (error) {
      logger.error('积分退还失败', { error: error.message });
      return false;
    }
  }

  /**
   * 准备实际发送的内容
   */
  static buildActualContent(content, fileInfo) {
    return content.trim();
  }
}

module.exports = MessageService;
