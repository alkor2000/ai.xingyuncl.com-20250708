/**
 * 消息数据模型 - 支持动态上下文数量
 */

const dbConnection = require('../database/connection');
const { v4: uuidv4 } = require('uuid');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class Message {
  constructor(data = {}) {
    this.id = data.id || null;
    this.conversation_id = data.conversation_id || null;
    this.role = data.role || null; // 'user', 'assistant', 'system'
    this.content = data.content || '';
    this.tokens = data.tokens || 0;
    this.file_id = data.file_id || null;
    this.created_at = data.created_at || null;
  }

  /**
   * 创建新消息
   */
  static async create(messageData) {
    try {
      const { conversation_id, role, content, tokens = 0, file_id = null } = messageData;
      const id = uuidv4();

      const sql = `
        INSERT INTO messages (id, conversation_id, role, content, tokens, file_id) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      // 确保所有参数都有值，null值用JS null而不是undefined
      const params = [
        id, 
        conversation_id, 
        role, 
        content, 
        parseInt(tokens) || 0, 
        file_id || null
      ];

      logger.info('创建消息', { 
        messageId: id, 
        conversationId: conversation_id, 
        role,
        tokens: params[4],
        hasFileId: !!file_id,
        params
      });

      await dbConnection.query(sql, params);

      logger.info('消息创建成功', { 
        messageId: id, 
        conversationId: conversation_id, 
        role,
        tokens: params[4]
      });

      return await Message.findById(id);
    } catch (error) {
      logger.error('消息创建失败:', error);
      throw new DatabaseError(`消息创建失败: ${error.message}`, error);
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
   * 获取会话的消息列表
   */
  static async getConversationMessages(conversationId, options = {}) {
    try {
      const { page = 1, limit = 50, order = 'ASC' } = options;
      
      // 获取总数
      const countSql = 'SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?';
      const { rows: totalRows } = await dbConnection.query(countSql, [conversationId]);
      const total = totalRows[0].total;
      
      // 获取消息列表  
      const offset = parseInt((page - 1) * limit);
      const limitNum = parseInt(limit);
      
      const listSql = `
        SELECT * FROM messages 
        WHERE conversation_id = ? 
        ORDER BY created_at ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      
      const { rows } = await dbConnection.query(listSql, [conversationId]);
      
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
   * 获取会话的最近消息（用于AI对话上下文）- 支持动态上下文数量
   */
  static async getRecentMessages(conversationId, limit = null) {
    try {
      let contextLimit = limit;
      
      // 如果没有指定limit，则从会话配置中获取
      if (contextLimit === null) {
        const conversationSql = 'SELECT context_length FROM conversations WHERE id = ?';
        const { rows: convRows } = await dbConnection.query(conversationSql, [conversationId]);
        
        if (convRows.length > 0) {
          contextLimit = parseInt(convRows[0].context_length) || 20;
        } else {
          contextLimit = 20; // 默认值
        }
      }
      
      const limitNum = parseInt(contextLimit);
      
      const sql = `
        SELECT * FROM messages 
        WHERE conversation_id = ? 
        ORDER BY created_at DESC
        LIMIT ${limitNum}
      `;
      
      logger.info('获取最近消息', { 
        conversationId, 
        contextLimit: limitNum,
        source: limit !== null ? 'parameter' : 'conversation_config'
      });
      
      const { rows } = await dbConnection.query(sql, [conversationId]);
      
      logger.info('获取最近消息成功', { 
        conversationId, 
        messageCount: rows.length,
        requestedLimit: limitNum,
        actualCount: rows.length
      });
      
      // 按时间正序返回（最老的在前）
      return rows.reverse().map(row => new Message(row));
    } catch (error) {
      logger.error('获取最近消息失败:', error);
      throw new DatabaseError(`获取最近消息失败: ${error.message}`, error);
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
      role: this.role,
      content: this.content,
      tokens: this.tokens,
      file_id: this.file_id,
      created_at: this.created_at
    };
  }
}

module.exports = Message;
