/**
 * 对话会话数据模型 - 支持动态上下文数量配置、temperature设置和优先级排序
 */

const { v4: uuidv4 } = require('uuid');
const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');
const SystemConfig = require('./SystemConfig');

class Conversation {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.title = data.title || 'New Chat';
    this.model_name = data.model_name || null;
    this.system_prompt = data.system_prompt || null;
    this.is_pinned = data.is_pinned || 0;
    this.priority = data.priority || 0; // 新增：优先级字段
    this.message_count = data.message_count || 0;
    this.total_tokens = data.total_tokens || 0;
    this.last_message_at = data.last_message_at || null;
    this.context_length = data.context_length || 20; // 上下文携带数量
    this.ai_temperature = data.ai_temperature || 0.0; // AI温度参数
    this.cleared_at = data.cleared_at || null; // 清空时间
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
   * 创建新会话 - 支持上下文数量、temperature设置和优先级
   */
  static async create(conversationData) {
    try {
      const {
        user_id,
        title = 'New Chat',
        model_name,
        system_prompt = null,
        context_length = 20, // 默认20条上下文
        ai_temperature,
        priority = 0 // 默认优先级为0
      } = conversationData;

      // 如果没有传入temperature，从系统配置获取默认值
      let defaultTemperature = 0.0;
      if (ai_temperature === undefined || ai_temperature === null) {
        try {
          const systemSettings = await SystemConfig.getFormattedSettings();
          if (systemSettings.ai && systemSettings.ai.temperature !== undefined) {
            defaultTemperature = parseFloat(systemSettings.ai.temperature) || 0.0;
            logger.info('使用系统配置的默认temperature', { defaultTemperature });
          }
        } catch (configError) {
          logger.warn('获取系统配置失败，使用默认temperature', { error: configError.message });
        }
      }

      const conversationId = uuidv4();
      
      const sql = `
        INSERT INTO conversations (id, user_id, title, model_name, system_prompt, priority, context_length, ai_temperature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await dbConnection.query(sql, [
        conversationId,
        user_id,
        title,
        model_name,
        system_prompt,
        Math.max(0, Math.min(10, parseInt(priority) || 0)), // 确保优先级在0-10范围内
        parseInt(context_length) || 20,
        ai_temperature !== undefined && ai_temperature !== null 
          ? parseFloat(ai_temperature) || 0.0 
          : defaultTemperature
      ]);

      logger.info('会话创建成功', { 
        conversationId,
        userId: user_id,
        modelName: model_name,
        contextLength: context_length,
        aiTemperature: ai_temperature !== undefined ? ai_temperature : defaultTemperature,
        priority: priority
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
      
      // 获取会话列表 - 修改排序逻辑：先按优先级降序，再按创建时间降序
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT * FROM conversations 
        WHERE user_id = ? 
        ORDER BY priority DESC, created_at DESC
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
   * 更新会话 - 支持上下文数量、temperature和优先级更新
   */
  async update(updateData) {
    try {
      const fields = [];
      const values = [];
      
      const allowedFields = ['title', 'model_name', 'system_prompt', 'is_pinned', 'priority', 'context_length', 'ai_temperature', 'message_count', 'total_tokens', 'last_message_at', 'cleared_at'];
      
      logger.info('开始更新会话', { 
        conversationId: this.id,
        updateData 
      });

      allowedFields.forEach(field => {
        // 检查字段是否存在且不为undefined
        if (updateData.hasOwnProperty(field) && updateData[field] !== undefined) {
          fields.push(`${field} = ?`);
          
          if (field === 'context_length') {
            // 确保上下文数量在合理范围内
            const contextLength = parseInt(updateData[field]) || 20;
            values.push(Math.max(0, Math.min(1000, contextLength)));
          } else if (field === 'ai_temperature') {
            // 确保temperature在0.0-1.0范围内
            const temperature = parseFloat(updateData[field]);
            if (isNaN(temperature)) {
              values.push(0.0);
            } else {
              values.push(Math.max(0.0, Math.min(1.0, temperature)));
            }
          } else if (field === 'priority') {
            // 确保优先级在0-10范围内
            const priority = parseInt(updateData[field]) || 0;
            values.push(Math.max(0, Math.min(10, priority)));
          } else if (field === 'system_prompt' || field === 'cleared_at' || field === 'last_message_at') {
            // 这些字段可以是null，但不能是undefined
            values.push(updateData[field] === null || updateData[field] === '' ? null : updateData[field]);
          } else {
            // 其他字段：将undefined转换为null
            values.push(updateData[field] === undefined ? null : updateData[field]);
          }
        }
      });
      
      if (fields.length === 0) {
        logger.info('没有需要更新的字段', { conversationId: this.id });
        return this;
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(this.id);
      
      const sql = `UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`;
      
      logger.info('执行更新SQL', { 
        conversationId: this.id,
        sql,
        values: values.map(v => v === null ? 'NULL' : v)
      });

      await dbConnection.query(sql, values);

      logger.info('会话更新成功', { 
        conversationId: this.id,
        updateData
      });

      return await Conversation.findById(this.id);
    } catch (error) {
      logger.error('更新会话失败:', {
        conversationId: this.id,
        updateData,
        error: error.message,
        stack: error.stack
      });
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
   * 获取上下文数量
   */
  getContextLength() {
    return parseInt(this.context_length) || 20;
  }

  /**
   * 获取AI温度参数
   */
  getTemperature() {
    return parseFloat(this.ai_temperature) || 0.0;
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
      priority: this.priority, // 返回优先级
      message_count: this.message_count,
      total_tokens: this.total_tokens,
      context_length: this.context_length,
      ai_temperature: this.ai_temperature,
      cleared_at: this.cleared_at,
      last_message_at: this.last_message_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Conversation;
