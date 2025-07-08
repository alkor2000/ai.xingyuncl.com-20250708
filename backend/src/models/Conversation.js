/**
 * 对话会话数据模型
 */

const { v4: uuidv4 } = require('uuid');
const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class Conversation {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.title = data.title || 'New Chat';
    this.model_name = data.model_name || null;
    this.system_prompt = data.system_prompt || null;
    this.is_pinned = data.is_pinned || 0;
    this.message_count = data.message_count || 0;
    this.total_tokens = data.total_tokens || 0;
    this.last_message_at = data.last_message_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 根据ID查找会话
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM conversations WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new Conversation(rows[0]);
    } catch (error) {
      logger.error('根据ID查找会话失败:', error);
      throw new DatabaseError(`查找会话失败: ${error.message}`, error);
    }
  }

  /**
   * 检查会话所有权
   */
  static async checkOwnership(conversationId, userId) {
    try {
      const sql = 'SELECT user_id FROM conversations WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [conversationId]);
      
      if (rows.length === 0) {
        return false;
      }
      
      return rows[0].user_id === userId;
    } catch (error) {
      logger.error('检查会话所有权失败:', error);
      return false;
    }
  }

  /**
   * 创建新会话
   */
  static async create(conversationData) {
    try {
      const {
        user_id,
        title = 'New Chat',
        model_name,
        system_prompt = null
      } = conversationData;

      const conversationId = uuidv4();
      
      const sql = `
        INSERT INTO conversations (id, user_id, title, model_name, system_prompt)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      await dbConnection.query(sql, [
        conversationId,
        user_id,
        title,
        model_name,
        system_prompt
      ]);

      logger.info('会话创建成功', { 
        conversationId,
        userId: user_id,
        modelName: model_name 
      });

      return await Conversation.findById(conversationId);
    } catch (error) {
      logger.error('创建会话失败:', error);
      throw new DatabaseError(`创建会话失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户的会话列表
   */
  static async getUserConversations(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      
      logger.info('开始获取用户会话列表', { userId, page, limit });
      
      // 获取总数
      const countSql = 'SELECT COUNT(*) as total FROM conversations WHERE user_id = ?';
      const { rows: totalRows } = await dbConnection.query(countSql, [userId]);
      const total = totalRows[0].total;
      
      logger.info('获取会话总数成功', { userId, total });
      
      // 获取会话列表 - 使用simpleQuery避免LIMIT/OFFSET参数绑定问题
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT * FROM conversations 
        WHERE user_id = ? 
        ORDER BY is_pinned DESC, last_message_at DESC
        LIMIT ? OFFSET ?
      `;
      
      logger.info('执行会话列表查询', { 
        userId, 
        limit, 
        offset
      });
      
      const { rows } = await dbConnection.simpleQuery(listSql, [userId, limit, offset]);
      
      logger.info('获取会话列表成功', { userId, count: rows.length });
      
      return {
        conversations: rows.map(row => new Conversation(row)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户会话列表失败:', {
        userId,
        error: error.message,
        stack: error.stack
      });
      throw new DatabaseError(`获取用户会话列表失败: ${error.message}`, error);
    }
  }

  /**
   * 更新会话
   */
  async update(updateData) {
    try {
      const fields = [];
      const values = [];
      
      const allowedFields = ['title', 'model_name', 'system_prompt', 'is_pinned'];
      
      allowedFields.forEach(field => {
        if (updateData.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      });
      
      if (fields.length === 0) {
        return this;
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(this.id);
      
      const sql = `UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`;
      
      await dbConnection.query(sql, values);

      logger.info('会话更新成功', { 
        conversationId: this.id,
        updateData
      });

      return await Conversation.findById(this.id);
    } catch (error) {
      logger.error('更新会话失败:', error);
      throw new DatabaseError(`更新会话失败: ${error.message}`, error);
    }
  }

  /**
   * 删除会话
   */
  async delete() {
    try {
      const sql = 'DELETE FROM conversations WHERE id = ?';
      await dbConnection.query(sql, [this.id]);

      logger.info('会话删除成功', { 
        conversationId: this.id 
      });
    } catch (error) {
      logger.error('删除会话失败:', error);
      throw new DatabaseError(`删除会话失败: ${error.message}`, error);
    }
  }

  /**
   * 更新消息统计
   */
  async updateMessageStats(messageCount, tokens) {
    try {
      const sql = `
        UPDATE conversations 
        SET message_count = ?, 
            total_tokens = ?, 
            last_message_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [messageCount, tokens, this.id]);

      logger.info('会话统计更新成功', { 
        conversationId: this.id,
        messageCount,
        tokens
      });
    } catch (error) {
      logger.error('更新会话统计失败:', error);
      throw new DatabaseError(`更新会话统计失败: ${error.message}`, error);
    }
  }

  /**
   * 更新统计信息 (兼容不同的方法名)
   */
  async updateStats(messageIncrement, tokenIncrement) {
    try {
      const newMessageCount = this.message_count + messageIncrement;
      const newTokenCount = this.total_tokens + tokenIncrement;
      
      await this.updateMessageStats(newMessageCount, newTokenCount);
      
      // 更新当前对象的属性
      this.message_count = newMessageCount;
      this.total_tokens = newTokenCount;
    } catch (error) {
      logger.error('更新统计信息失败:', error);
      throw new DatabaseError(`更新统计信息失败: ${error.message}`, error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      title: this.title,
      model_name: this.model_name,
      system_prompt: this.system_prompt,
      is_pinned: this.is_pinned,
      message_count: this.message_count,
      total_tokens: this.total_tokens,
      last_message_at: this.last_message_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Conversation;
