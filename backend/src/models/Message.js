/**
 * 消息数据模型 - 支持动态上下文数量、清空时间过滤、消息状态跟踪、序号排序和生成的图片
 * 
 * v2.0 变更：
 *   - 新增 file_ids JSON 字段，支持多图上传（向后兼容原 file_id 单值字段）
 *   - 新增 getAllFileIds() 方法，统一获取关联文件ID
 *   - create 方法支持 file_ids 参数
 *   - toJSON 方法包含 file_ids 字段
 */

const dbConnection = require('../database/connection');
const { v4: uuidv4 } = require('uuid');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class Message {
  /**
   * 构造函数
   * @param {Object} data - 数据库行数据
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.conversation_id = data.conversation_id || null;
    this.sequence_number = data.sequence_number || 0;
    this.role = data.role || null;                    // 'user', 'assistant', 'system'
    this.content = data.content || '';
    this.tokens = data.tokens || 0;
    this.model_name = data.model_name || null;
    this.status = data.status || 'completed';         // pending, streaming, completed, failed
    this.file_id = data.file_id || null;              // 保留：向后兼容单文件
    this.file_ids = data.file_ids || null;            // v2.0 新增：多文件ID数组（JSON）
    this.generated_images = data.generated_images || null;
    this.created_at = data.created_at || null;
  }

  /**
   * 获取会话的下一个序号
   * @param {string} conversationId - 会话ID
   * @returns {number} 下一个序号
   */
  static async getNextSequenceNumber(conversationId) {
    try {
      const sql = 'SELECT MAX(sequence_number) as max_seq FROM messages WHERE conversation_id = ?';
      const { rows } = await dbConnection.query(sql, [conversationId]);
      const maxSeq = rows[0]?.max_seq || 0;
      return maxSeq + 1;
    } catch (error) {
      logger.error('获取下一个序号失败:', error);
      return 1;
    }
  }

  /**
   * 创建新消息 - 自动分配序号
   * v2.0: 支持 file_ids 多文件ID数组
   * 
   * @param {Object} messageData - 消息数据
   * @param {string} messageData.conversation_id - 会话ID
   * @param {string} messageData.role - 角色
   * @param {string} messageData.content - 内容
   * @param {number} [messageData.tokens=0] - Token数量
   * @param {string} [messageData.model_name] - 模型名称
   * @param {string} [messageData.status='completed'] - 状态
   * @param {string} [messageData.file_id] - 单文件ID（向后兼容）
   * @param {string[]} [messageData.file_ids] - 多文件ID数组（v2.0新增）
   * @param {Array|string} [messageData.generated_images] - 生成的图片
   * @returns {Message} 创建的消息对象
   */
  static async create(messageData) {
    try {
      const {
        conversation_id,
        role,
        content,
        tokens = 0,
        model_name = null,
        status = 'completed',
        file_id = null,
        file_ids = null,
        generated_images = null,
        id = null,
        sequence_number = null
      } = messageData;

      const messageId = id || uuidv4();

      // 如果没有指定序号，自动获取下一个
      let finalSequenceNumber = sequence_number;
      if (finalSequenceNumber === null || finalSequenceNumber === undefined) {
        finalSequenceNumber = await Message.getNextSequenceNumber(conversation_id);
      }

      // 处理 generated_images，确保是JSON字符串
      let generatedImagesJson = null;
      if (generated_images) {
        generatedImagesJson = typeof generated_images === 'string'
          ? generated_images
          : JSON.stringify(generated_images);
      }

      // v2.0: 处理 file_ids，确保是JSON字符串
      let fileIdsJson = null;
      if (file_ids) {
        if (typeof file_ids === 'string') {
          fileIdsJson = file_ids;
        } else if (Array.isArray(file_ids)) {
          fileIdsJson = JSON.stringify(file_ids);
        }
      }

      // v2.0 兼容逻辑：如果有 file_ids 但没有 file_id，取第一个作为 file_id
      let finalFileId = file_id;
      if (!finalFileId && file_ids && Array.isArray(file_ids) && file_ids.length > 0) {
        finalFileId = file_ids[0];
      }

      const sql = `
        INSERT INTO messages (
          id, conversation_id, sequence_number, role, content,
          tokens, model_name, status, file_id, file_ids, generated_images
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        messageId,
        conversation_id,
        finalSequenceNumber,
        role,
        content,
        parseInt(tokens) || 0,
        model_name || null,
        status || 'completed',
        finalFileId || null,
        fileIdsJson,
        generatedImagesJson
      ];

      logger.info('创建消息', {
        messageId,
        conversationId: conversation_id,
        sequenceNumber: finalSequenceNumber,
        role,
        tokens: params[5],
        modelName: model_name,
        status,
        hasFileId: !!finalFileId,
        hasFileIds: !!(file_ids && Array.isArray(file_ids) && file_ids.length > 0),
        fileIdsCount: (file_ids && Array.isArray(file_ids)) ? file_ids.length : 0,
        hasGeneratedImages: !!generated_images
      });

      await dbConnection.query(sql, params);

      return await Message.findById(messageId);
    } catch (error) {
      logger.error('消息创建失败:', error);
      throw new DatabaseError(`消息创建失败: ${error.message}`, error);
    }
  }

  /**
   * 创建流式消息占位符 - 自动分配序号
   * @param {Object} messageData - 消息数据
   * @returns {Message} 创建的占位消息
   */
  static async createStreamingPlaceholder(messageData) {
    return await Message.create({
      ...messageData,
      status: 'streaming',
      content: messageData.content || ''
    });
  }

  /**
   * 更新消息状态和生成的图片
   * @param {string} messageId - 消息ID
   * @param {string} status - 新状态
   * @param {string} [content] - 新内容
   * @param {number} [tokens] - Token数
   * @param {Array} [generatedImages] - 生成的图片
   * @returns {boolean} 是否成功
   */
  static async updateStatus(messageId, status, content = null, tokens = null, generatedImages = null) {
    try {
      let sql = 'UPDATE messages SET status = ?';
      const params = [status];

      if (content !== null) {
        sql += ', content = ?';
        params.push(content);
      }

      if (tokens !== null) {
        sql += ', tokens = ?';
        params.push(tokens);
      }

      if (generatedImages !== null) {
        sql += ', generated_images = ?';
        const json = typeof generatedImages === 'string'
          ? generatedImages
          : JSON.stringify(generatedImages);
        params.push(json);
      }

      sql += ' WHERE id = ?';
      params.push(messageId);

      await dbConnection.query(sql, params);

      logger.info('消息状态更新成功', {
        messageId, status,
        hasContent: content !== null,
        hasTokens: tokens !== null,
        hasGeneratedImages: generatedImages !== null
      });

      return true;
    } catch (error) {
      logger.error('更新消息状态失败:', error);
      throw new DatabaseError(`更新消息状态失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID查找消息
   * @param {string} id - 消息UUID
   * @returns {Message|null} 消息对象
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM messages WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) {
        return null;
      }

      return new Message(rows[0]);
    } catch (error) {
      logger.error('根据ID查找消息失败:', error);
      throw new DatabaseError(`查找消息失败: ${error.message}`, error);
    }
  }

  /**
   * 获取会话的消息列表
   * 考虑清空时间(cleared_at)过滤，默认不显示失败/流式中的消息，按序号排序
   * 
   * @param {string} conversationId - 会话ID
   * @param {Object} options - 查询选项
   * @param {number} [options.page=1] - 页码
   * @param {number} [options.limit=50] - 每页数量
   * @param {string} [options.order='ASC'] - 排序方向
   * @param {boolean} [options.includeStreaming=false] - 是否包含流式/失败消息
   * @returns {Object} { messages, pagination }
   */
  static async getConversationMessages(conversationId, options = {}) {
    try {
      const { page = 1, limit = 50, order = 'ASC', includeStreaming = false } = options;

      // 获取会话的 cleared_at 时间
      const convSql = 'SELECT cleared_at FROM conversations WHERE id = ?';
      const { rows: convRows } = await dbConnection.query(convSql, [conversationId]);

      let clearedAt = null;
      if (convRows.length > 0 && convRows[0].cleared_at) {
        clearedAt = convRows[0].cleared_at;
        logger.info('会话有清空时间', { conversationId, clearedAt });
      }

      // 构建查询条件
      let whereClause = 'WHERE conversation_id = ?';
      const params = [conversationId];

      if (clearedAt) {
        whereClause += ' AND created_at > ?';
        params.push(clearedAt);
      }

      if (!includeStreaming) {
        whereClause += " AND status IN ('completed', 'pending')";
      }

      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM messages ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      // 获取消息列表 - 按 sequence_number 排序
      const offset = parseInt((page - 1) * limit);
      const limitNum = parseInt(limit);
      const orderDir = order === 'ASC' ? 'ASC' : 'DESC';

      const listSql = `
        SELECT * FROM messages
        ${whereClause}
        ORDER BY sequence_number ${orderDir}, created_at ${orderDir}
        LIMIT ${limitNum} OFFSET ${offset}
      `;

      const { rows } = await dbConnection.query(listSql, params);

      logger.info('获取会话消息列表', {
        conversationId, clearedAt, total,
        returned: rows.length, includeStreaming
      });

      return {
        messages: rows.map(row => new Message(row)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取会话消息列表失败:', error);
      throw new DatabaseError(`获取消息列表失败: ${error.message}`, error);
    }
  }

  /**
   * 获取会话的最近消息（用于AI对话上下文构建）
   * 按序号倒序获取，再正序返回（最老的在前）
   * 
   * @param {string} conversationId - 会话ID
   * @param {number} [limit=null] - 获取数量，null则使用会话配置的 context_length
   * @returns {Message[]} 消息数组（按时间正序）
   */
  static async getRecentMessages(conversationId, limit = null) {
    try {
      // 获取会话的 context_length 和 cleared_at
      const conversationSql = 'SELECT context_length, cleared_at FROM conversations WHERE id = ?';
      const { rows: convRows } = await dbConnection.query(conversationSql, [conversationId]);

      let contextLimit = limit;
      let clearedAt = null;

      if (convRows.length > 0) {
        if (contextLimit === null) {
          contextLimit = parseInt(convRows[0].context_length) || 20;
        }
        if (convRows[0].cleared_at) {
          clearedAt = convRows[0].cleared_at;
          logger.info('会话有清空时间，将过滤历史消息', { conversationId, clearedAt });
        }
      } else {
        contextLimit = contextLimit || 20;
      }

      const limitNum = parseInt(contextLimit);

      // 只获取已完成的消息用于上下文，按序号排序
      let sql;
      let params = [conversationId];

      if (clearedAt) {
        sql = `
          SELECT * FROM messages
          WHERE conversation_id = ?
            AND created_at > ?
            AND status = 'completed'
          ORDER BY sequence_number DESC
          LIMIT ${limitNum}
        `;
        params.push(clearedAt);
      } else {
        sql = `
          SELECT * FROM messages
          WHERE conversation_id = ?
            AND status = 'completed'
          ORDER BY sequence_number DESC
          LIMIT ${limitNum}
        `;
      }

      logger.info('获取最近消息', {
        conversationId,
        contextLimit: limitNum,
        clearedAt,
        source: limit !== null ? 'parameter' : 'conversation_config'
      });

      const { rows } = await dbConnection.query(sql, params);

      logger.info('获取最近消息成功', {
        conversationId,
        messageCount: rows.length,
        requestedLimit: limitNum,
        filtered: !!clearedAt
      });

      // 按序号正序返回（最老的在前，最新的在后）
      return rows.reverse().map(row => new Message(row));
    } catch (error) {
      logger.error('获取最近消息失败:', error);
      throw new DatabaseError(`获取最近消息失败: ${error.message}`, error);
    }
  }

  /**
   * 检查并恢复未完成的流式消息
   * 超过5分钟仍在 streaming 状态的消息会被恢复：有内容→completed，无内容→failed
   * 
   * @param {string} conversationId - 会话ID
   * @returns {number} 恢复的消息数量
   */
  static async checkAndRecoverStreamingMessages(conversationId) {
    try {
      const sql = `
        SELECT id, content, tokens FROM messages
        WHERE conversation_id = ?
          AND status = 'streaming'
          AND created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      `;

      const { rows } = await dbConnection.query(sql, [conversationId]);

      if (rows.length > 0) {
        logger.warn('发现未完成的流式消息', { conversationId, count: rows.length });

        for (const msg of rows) {
          const newStatus = msg.content && msg.content.length > 0 ? 'completed' : 'failed';
          await Message.updateStatus(msg.id, newStatus);
          logger.info('恢复流式消息状态', {
            messageId: msg.id, newStatus,
            contentLength: msg.content?.length || 0
          });
        }
      }

      return rows.length;
    } catch (error) {
      logger.error('检查流式消息失败:', error);
      return 0;
    }
  }

  /**
   * 批量创建消息
   * @param {Object[]} messages - 消息数据数组
   * @returns {Message[]} 创建的消息对象数组
   */
  static async createBatch(messages) {
    try {
      const results = [];
      for (const messageData of messages) {
        const message = await Message.create(messageData);
        results.push(message);
      }
      return results;
    } catch (error) {
      logger.error('批量创建消息失败:', error);
      throw new DatabaseError(`批量创建消息失败: ${error.message}`, error);
    }
  }

  /**
   * 删除消息
   */
  async delete() {
    try {
      const sql = 'DELETE FROM messages WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      logger.info('消息删除成功', { messageId: this.id });
    } catch (error) {
      logger.error('消息删除失败:', error);
      throw new DatabaseError(`消息删除失败: ${error.message}`, error);
    }
  }

  /**
   * 删除消息对（用户消息和对应的AI回复）并更新后续消息的序号
   * @param {string} conversationId - 会话ID
   * @param {string} aiMessageId - AI消息ID
   * @returns {Object} { deletedUserMessageId, deletedAiMessageId }
   */
  static async deleteMessagePair(conversationId, aiMessageId) {
    try {
      const result = await dbConnection.transaction(async (query) => {
        // 获取AI消息的序号
        const aiMessageSql = 'SELECT sequence_number FROM messages WHERE id = ? AND conversation_id = ? AND role = ?';
        const { rows: aiRows } = await query(aiMessageSql, [aiMessageId, conversationId, 'assistant']);

        if (aiRows.length === 0) {
          throw new Error('AI消息不存在');
        }

        const aiSeqNumber = aiRows[0].sequence_number;

        // 查找前一条用户消息（序号应该是AI消息序号-1）
        const userSeqNumber = aiSeqNumber - 1;
        const userMessageSql = `
          SELECT id FROM messages
          WHERE conversation_id = ?
            AND sequence_number = ?
            AND role = 'user'
        `;

        let { rows: userRows } = await query(userMessageSql, [conversationId, userSeqNumber]);

        if (userRows.length === 0) {
          // 找不到序号-1的用户消息，尝试通过时间查找最近的
          const userMessageTimeSql = `
            SELECT id FROM messages
            WHERE conversation_id = ?
              AND role = 'user'
              AND sequence_number < ?
            ORDER BY sequence_number DESC
            LIMIT 1
          `;
          const { rows: userTimeRows } = await query(userMessageTimeSql, [conversationId, aiSeqNumber]);

          if (userTimeRows.length === 0) {
            throw new Error('找不到对应的用户消息');
          }
          userRows = userTimeRows;
        }

        const userMessageId = userRows[0].id;

        // 删除用户消息和AI消息
        await query('DELETE FROM messages WHERE id = ?', [userMessageId]);
        logger.info('删除用户消息', { messageId: userMessageId, conversationId });

        await query('DELETE FROM messages WHERE id = ?', [aiMessageId]);
        logger.info('删除AI消息', { messageId: aiMessageId, conversationId });

        // 更新后续消息的序号（减2）
        await query(`
          UPDATE messages
          SET sequence_number = sequence_number - 2
          WHERE conversation_id = ?
            AND sequence_number > ?
        `, [conversationId, aiSeqNumber]);

        // 更新会话的消息计数和token统计
        await query(`
          UPDATE conversations
          SET message_count = message_count - 2,
              total_tokens = (
                SELECT COALESCE(SUM(tokens), 0)
                FROM messages
                WHERE conversation_id = ?
                  AND status = 'completed'
              )
          WHERE id = ?
        `, [conversationId, conversationId]);

        logger.info('消息对删除成功', { conversationId, userMessageId, aiMessageId });

        return {
          deletedUserMessageId: userMessageId,
          deletedAiMessageId: aiMessageId
        };
      });

      return result;
    } catch (error) {
      logger.error('删除消息对失败:', error);
      throw new DatabaseError(`删除消息对失败: ${error.message}`, error);
    }
  }

  /**
   * 计算消息Token数量（简单估算）
   * 英文约4字符=1token，中文约1.5字符=1token
   * @param {string} content - 消息内容
   * @returns {number} 估算的Token数量
   */
  static estimateTokens(content) {
    if (!content || typeof content !== 'string') {
      return 0;
    }
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }

  /**
   * 格式化为AI API所需的格式（纯文本，不含文件信息）
   * 文件信息在 MessageService.buildAIContext 中单独处理
   * @returns {Object} { role, content }
   */
  toAIFormat() {
    return {
      role: this.role,
      content: this.content || ''
    };
  }

  /**
   * v2.0: 获取所有关联文件ID（统一 file_id 和 file_ids）
   * 优先使用 file_ids 数组，为空时回退到 file_id 单值
   * @returns {string[]} 文件ID数组
   */
  getAllFileIds() {
    const ids = [];

    // 优先使用 file_ids 数组
    if (this.file_ids) {
      let parsed = this.file_ids;
      // MySQL JSON 字段可能被 mysql2 驱动自动解析为数组
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          logger.warn('解析file_ids失败', { messageId: this.id, raw: parsed });
          parsed = [];
        }
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }

    // 回退：使用 file_id 单值（向后兼容旧消息）
    if (this.file_id) {
      ids.push(this.file_id);
    }

    return ids;
  }

  /**
   * 转换为JSON格式（用于API响应和缓存）
   * v2.0: 包含 file_ids 字段
   * @returns {Object} 消息的JSON表示
   */
  toJSON() {
    return {
      id: this.id,
      conversation_id: this.conversation_id,
      sequence_number: this.sequence_number,
      role: this.role,
      content: this.content,
      tokens: this.tokens,
      model_name: this.model_name,
      status: this.status,
      file_id: this.file_id,
      file_ids: this.file_ids,
      generated_images: this.generated_images,
      created_at: this.created_at
    };
  }
}

module.exports = Message;
