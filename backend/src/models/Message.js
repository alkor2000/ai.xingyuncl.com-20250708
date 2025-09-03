/**
 * 消息数据模型 - 支持动态上下文数量、清空时间过滤、消息状态跟踪、序号排序和生成的图片
 */

const dbConnection = require('../database/connection');
const { v4: uuidv4 } = require('uuid');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class Message {
  constructor(data = {}) {
    this.id = data.id || null;
    this.conversation_id = data.conversation_id || null;
    this.sequence_number = data.sequence_number || 0; // 添加序号字段
    this.role = data.role || null; // 'user', 'assistant', 'system'
    this.content = data.content || '';
    this.tokens = data.tokens || 0;
    this.model_name = data.model_name || null; // 记录消息生成时使用的模型
    this.status = data.status || 'completed'; // 消息状态：pending, streaming, completed, failed
    this.file_id = data.file_id || null;
    this.generated_images = data.generated_images || null; // 生成的图片信息
    this.created_at = data.created_at || null;
  }

  /**
   * 获取会话的下一个序号
   */
  static async getNextSequenceNumber(conversationId) {
    try {
      const sql = 'SELECT MAX(sequence_number) as max_seq FROM messages WHERE conversation_id = ?';
      const { rows } = await dbConnection.query(sql, [conversationId]);
      
      const maxSeq = rows[0]?.max_seq || 0;
      return maxSeq + 1;
    } catch (error) {
      logger.error('获取下一个序号失败:', error);
      return 1; // 出错时返回1
    }
  }

  /**
   * 创建新消息 - 自动分配序号，支持生成的图片
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
        generated_images = null, // 新增：生成的图片
        id = null,
        sequence_number = null // 可以手动指定序号
      } = messageData;
      const messageId = id || uuidv4();

      // 如果没有指定序号，自动获取下一个序号
      let finalSequenceNumber = sequence_number;
      if (finalSequenceNumber === null || finalSequenceNumber === undefined) {
        finalSequenceNumber = await Message.getNextSequenceNumber(conversation_id);
      }

      // 处理generated_images，确保是JSON字符串
      let generatedImagesJson = null;
      if (generated_images) {
        if (typeof generated_images === 'string') {
          generatedImagesJson = generated_images;
        } else {
          generatedImagesJson = JSON.stringify(generated_images);
        }
      }

      const sql = `
        INSERT INTO messages (id, conversation_id, sequence_number, role, content, tokens, model_name, status, file_id, generated_images) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      // 确保所有参数都有值，null值用JS null而不是undefined
      const params = [
        messageId, 
        conversation_id,
        finalSequenceNumber, // 使用序号
        role, 
        content, 
        parseInt(tokens) || 0,
        model_name || null,
        status || 'completed',
        file_id || null,
        generatedImagesJson // 生成的图片JSON
      ];

      logger.info('创建消息', { 
        messageId: messageId, 
        conversationId: conversation_id,
        sequenceNumber: finalSequenceNumber,
        role,
        tokens: params[5],
        modelName: model_name,
        status: status,
        hasFileId: !!file_id,
        hasGeneratedImages: !!generated_images
      });

      await dbConnection.query(sql, params);

      logger.info('消息创建成功', { 
        messageId: messageId, 
        conversationId: conversation_id,
        sequenceNumber: finalSequenceNumber,
        role,
        tokens: params[5],
        modelName: model_name,
        status: status,
        hasGeneratedImages: !!generated_images
      });

      return await Message.findById(messageId);
    } catch (error) {
      logger.error('消息创建失败:', error);
      throw new DatabaseError(`消息创建失败: ${error.message}`, error);
    }
  }

  /**
   * 创建流式消息占位符 - 自动分配序号
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
        const generatedImagesJson = typeof generatedImages === 'string' 
          ? generatedImages 
          : JSON.stringify(generatedImages);
        params.push(generatedImagesJson);
      }
      
      sql += ' WHERE id = ?';
      params.push(messageId);
      
      await dbConnection.query(sql, params);
      
      logger.info('消息状态更新成功', { 
        messageId, 
        status,
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
   * 获取会话的消息列表（考虑清空时间，过滤失败的流式消息，按序号排序）
   */
  static async getConversationMessages(conversationId, options = {}) {
    try {
      const { page = 1, limit = 50, order = 'ASC', includeStreaming = false } = options;
      
      // 首先获取会话的cleared_at时间
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
      
      // 默认不显示失败和流式传输中的消息（除非特别要求）
      if (!includeStreaming) {
        whereClause += " AND status IN ('completed', 'pending')";
      }
      
      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM messages ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;
      
      // 获取消息列表 - 按sequence_number排序，如果序号相同则按created_at排序
      const offset = parseInt((page - 1) * limit);
      const limitNum = parseInt(limit);
      
      const listSql = `
        SELECT * FROM messages 
        ${whereClause}
        ORDER BY sequence_number ${order === 'ASC' ? 'ASC' : 'DESC'}, created_at ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      
      const { rows } = await dbConnection.query(listSql, params);
      
      logger.info('获取会话消息列表', { 
        conversationId, 
        clearedAt,
        total,
        returned: rows.length,
        includeStreaming
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
   * 获取会话的最近消息（用于AI对话上下文）- 按序号排序
   */
  static async getRecentMessages(conversationId, limit = null) {
    try {
      // 首先获取会话的context_length和cleared_at
      const conversationSql = 'SELECT context_length, cleared_at FROM conversations WHERE id = ?';
      const { rows: convRows } = await dbConnection.query(conversationSql, [conversationId]);
      
      let contextLimit = limit;
      let clearedAt = null;
      
      if (convRows.length > 0) {
        // 如果没有指定limit，使用会话配置的context_length
        if (contextLimit === null) {
          contextLimit = parseInt(convRows[0].context_length) || 20;
        }
        
        // 获取清空时间
        if (convRows[0].cleared_at) {
          clearedAt = convRows[0].cleared_at;
          logger.info('会话有清空时间，将过滤历史消息', { 
            conversationId, 
            clearedAt 
          });
        }
      } else {
        contextLimit = contextLimit || 20; // 默认值
      }
      
      const limitNum = parseInt(contextLimit);
      
      // 构建SQL查询 - 只获取已完成的消息用于上下文，按序号排序
      let sql;
      let params = [conversationId];
      
      if (clearedAt) {
        // 如果有清空时间，只获取清空后的已完成消息
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
        // 没有清空时间，获取所有已完成的消息
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
        actualCount: rows.length,
        filtered: !!clearedAt
      });
      
      // 按序号正序返回（最老的在前）
      return rows.reverse().map(row => new Message(row));
    } catch (error) {
      logger.error('获取最近消息失败:', error);
      throw new DatabaseError(`获取最近消息失败: ${error.message}`, error);
    }
  }

  /**
   * 检查并恢复未完成的流式消息
   */
  static async checkAndRecoverStreamingMessages(conversationId) {
    try {
      // 查找超过5分钟还在streaming状态的消息
      const sql = `
        SELECT id, content, tokens FROM messages 
        WHERE conversation_id = ? 
          AND status = 'streaming' 
          AND created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      `;
      
      const { rows } = await dbConnection.query(sql, [conversationId]);
      
      if (rows.length > 0) {
        logger.warn('发现未完成的流式消息', { 
          conversationId, 
          count: rows.length 
        });
        
        // 如果有内容，标记为完成；否则标记为失败
        for (const msg of rows) {
          const newStatus = msg.content && msg.content.length > 0 ? 'completed' : 'failed';
          await Message.updateStatus(msg.id, newStatus);
          
          logger.info('恢复流式消息状态', {
            messageId: msg.id,
            newStatus,
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
   * 删除消息对（用户消息和对应的AI回复）- 更新后续消息的序号
   */
  static async deleteMessagePair(conversationId, aiMessageId) {
    try {
      // 使用dbConnection提供的事务方法
      const result = await dbConnection.transaction(async (query) => {
        // 首先获取AI消息的序号
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
        
        const { rows: userRows } = await query(userMessageSql, [conversationId, userSeqNumber]);
        
        if (userRows.length === 0) {
          // 如果找不到序号-1的用户消息，尝试通过时间查找
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
          
          userRows[0] = userTimeRows[0];
        }
        
        const userMessageId = userRows[0].id;
        
        // 删除用户消息
        await query('DELETE FROM messages WHERE id = ?', [userMessageId]);
        logger.info('删除用户消息', { messageId: userMessageId, conversationId });
        
        // 删除AI消息
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
        const updateConversationSql = `
          UPDATE conversations 
          SET message_count = message_count - 2,
              total_tokens = (
                SELECT COALESCE(SUM(tokens), 0) 
                FROM messages 
                WHERE conversation_id = ?
                  AND status = 'completed'
              )
          WHERE id = ?
        `;
        
        await query(updateConversationSql, [conversationId, conversationId]);
        
        logger.info('消息对删除成功', { 
          conversationId, 
          userMessageId, 
          aiMessageId 
        });
        
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
   */
  static estimateTokens(content) {
    if (!content || typeof content !== 'string') {
      return 0;
    }
    // 简单的Token估算：英文约4字符=1token，中文约1.5字符=1token
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }

  /**
   * 格式化为AI API所需的格式
   */
  toAIFormat() {
    return {
      role: this.role,
      content: this.content || ''
    };
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      conversation_id: this.conversation_id,
      sequence_number: this.sequence_number, // 包含序号
      role: this.role,
      content: this.content,
      tokens: this.tokens,
      model_name: this.model_name,
      status: this.status,
      file_id: this.file_id,
      generated_images: this.generated_images, // 包含生成的图片
      created_at: this.created_at
    };
  }
}

module.exports = Message;
