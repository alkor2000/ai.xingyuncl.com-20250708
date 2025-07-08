/**
 * 会话数据模型
 */

const dbConnection = require('../database/connection');
const { v4: uuidv4 } = require('uuid');
const { DatabaseError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

class Conversation {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.title = data.title || 'New Chat';
    this.model_name = data.model_name || 'gpt-3.5-turbo';
    this.system_prompt = data.system_prompt || null;
    this.is_pinned = data.is_pinned || false;
    this.message_count = data.message_count || 0;
    this.total_tokens = data.total_tokens || 0;
    this.last_message_at = data.last_message_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 创建新会话
   */
  static async create(conversationData) {
    try {
      const { user_id, title = 'New Chat', model_name = 'gpt-3.5-turbo', system_prompt } = conversationData;
      const id = uuidv4();

      const sql = `
        INSERT INTO conversations (id, user_id, title, model_name, system_prompt) 
        VALUES (?, ?, ?, ?, ?)
      `;
      
      await dbConnection.query(sql, [id, user_id, title, model_name, system_prompt]);

      logger.info('会话创建成功', { 
        conversationId: id, 
        userId: user_id, 
        title,
        model_name 
      });

      return await Conversation.findById(id);
    } catch (error) {
      logger.error('会话创建失败:', error);
      throw new DatabaseError(`会话创建失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID查找会话
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM conversations WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (!rows || rows.length === 0) {
        return null;
      }
      
      return new Conversation(rows[0]);
    } catch (error) {
      logger.error('根据ID查找会话失败:', error);
      throw new DatabaseError(`查找会话失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户的会话列表
   */
  static async getUserConversations(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      
      // 获取总数
      const countSql = 'SELECT COUNT(*) as total FROM conversations WHERE user_id = ?';
      const { rows: totalRows } = await dbConnection.query(countSql, [userId]);
      const total = totalRows[0].total;
      
      // 获取会话列表
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT * FROM conversations 
        WHERE user_id = ? 
        ORDER BY is_pinned DESC, 
                 COALESCE(last_message_at, created_at) DESC, 
                 created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      const { rows } = await dbConnection.query(listSql, [userId, limit, offset]);
      
      return {
        conversations: rows.map(row => new Conversation(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户会话列表失败:', error);
      throw new DatabaseError(`获取会话列表失败: ${error.message}`, error);
    }
  }

  /**
   * 更新会话信息
   */
  async update(updateData) {
    try {
      const { title, model_name, system_prompt, is_pinned } = updateData;
      
      const sql = `
        UPDATE conversations 
        SET title = ?, model_name = ?, system_prompt = ?, is_pinned = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [
        title !== undefined ? title : this.title,
        model_name !== undefined ? model_name : this.model_name,
        system_prompt !== undefined ? system_prompt : this.system_prompt,
        is_pinned !== undefined ? is_pinned : this.is_pinned,
        this.id
      ]);

      logger.info('会话更新成功', { conversationId: this.id, updateData });
      return await Conversation.findById(this.id);
    } catch (error) {
      logger.error('会话更新失败:', error);
      throw new DatabaseError(`会话更新失败: ${error.message}`, error);
    }
  }

  /**
   * 更新消息统计
   */
  async updateStats(messageCount, tokens) {
    try {
      const sql = `
        UPDATE conversations 
        SET message_count = message_count + ?, total_tokens = total_tokens + ?, 
            last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [messageCount, tokens, this.id]);

      this.message_count += messageCount;
      this.total_tokens += tokens;
      this.last_message_at = new Date();

      logger.info('会话统计更新', { 
        conversationId: this.id, 
        messageCount, 
        tokens,
        totalMessages: this.message_count,
        totalTokens: this.total_tokens
      });
    } catch (error) {
      logger.error('会话统计更新失败:', error);
      throw new DatabaseError(`会话统计更新失败: ${error.message}`, error);
    }
  }

  /**
   * 删除会话
   */
  async delete() {
    try {
      const sql = 'DELETE FROM conversations WHERE id = ?';
      await dbConnection.query(sql, [this.id]);

      logger.info('会话删除成功', { conversationId: this.id });
    } catch (error) {
      logger.error('会话删除失败:', error);
      throw new DatabaseError(`会话删除失败: ${error.message}`, error);
    }
  }

  /**
   * 检查用户是否拥有会话
   */
  static async checkOwnership(conversationId, userId) {
    try {
      const sql = 'SELECT id FROM conversations WHERE id = ? AND user_id = ?';
      const { rows } = await dbConnection.query(sql, [conversationId, userId]);
      
      return rows && rows.length > 0;
    } catch (error) {
      logger.error('检查会话所有权失败:', error);
      throw new DatabaseError(`检查会话所有权失败: ${error.message}`, error);
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
