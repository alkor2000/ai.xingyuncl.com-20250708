/**
 * AI模型数据模型 - 支持积分消费配置和流式输出（第1阶段：流式字段支持）
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class AIModel {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || null;
    this.display_name = data.display_name || null;
    this.api_key = data.api_key || null;
    this.provider = data.provider || null;
    this.api_endpoint = data.api_endpoint || null;
    this.model_config = data.model_config || {};
    this.stream_enabled = data.stream_enabled !== undefined ? data.stream_enabled : true; // 🆕 流式输出开关
    this.credits_per_chat = data.credits_per_chat || 10;
    this.is_active = data.is_active !== undefined ? data.is_active : true;
    this.sort_order = data.sort_order || 0;
    this.test_status = data.test_status || 'untested';
    this.last_tested_at = data.last_tested_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 获取所有可用的AI模型
   */
  static async getAvailableModels() {
    try {
      const sql = `
        SELECT * FROM ai_models 
        WHERE is_active = true 
        ORDER BY sort_order ASC, created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      return rows.map(row => new AIModel(row));
    } catch (error) {
      logger.error('获取可用AI模型失败:', error);
      throw new DatabaseError(`获取AI模型失败: ${error.message}`, error);
    }
  }

  /**
   * 根据名称查找AI模型
   */
  static async findByName(name) {
    try {
      const sql = 'SELECT * FROM ai_models WHERE name = ? AND is_active = true';
      const { rows } = await dbConnection.query(sql, [name]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new AIModel(rows[0]);
    } catch (error) {
      logger.error('根据名称查找AI模型失败:', error);
      throw new DatabaseError(`查找AI模型失败: ${error.message}`, error);
    }
  }

  /**
   * 根据模型名称推断提供商
   */
  static inferProvider(modelName) {
    if (modelName.includes('gpt') || modelName.includes('chatgpt')) {
      return 'openai';
    } else if (modelName.includes('claude')) {
      return 'anthropic';
    } else if (modelName.includes('gemini') || modelName.includes('palm')) {
      return 'google';
    } else if (modelName.includes('llama')) {
      return 'meta';
    } else if (modelName.includes('deepseek')) {
      return 'deepseek';
    } else {
      return 'custom';
    }
  }

  /**
   * 创建新的AI模型配置（支持流式输出配置）
   */
  static async create(modelData) {
    try {
      const { 
        name, 
        display_name, 
        api_key,
        api_endpoint, 
        model_config = {},
        stream_enabled = true, // 🆕 流式输出开关，默认启用
        credits_per_chat = 10,
        sort_order = 0 
      } = modelData;

      // 根据模型名称自动推断提供商
      const provider = AIModel.inferProvider(name);

      const sql = `
        INSERT INTO ai_models (name, display_name, api_key, provider, api_endpoint, 
                              model_config, stream_enabled, credits_per_chat, sort_order, test_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested')
      `;
      
      const { rows } = await dbConnection.query(sql, [
        name, 
        display_name, 
        api_key,
        provider,
        api_endpoint, 
        JSON.stringify(model_config),
        stream_enabled, // 🆕 流式输出配置
        credits_per_chat,
        sort_order
      ]);

      logger.info('AI模型创建成功', { 
        modelId: rows.insertId, 
        name, 
        display_name,
        provider,
        stream_enabled,
        credits_per_chat
      });

      return await AIModel.findById(rows.insertId);
    } catch (error) {
      logger.error('AI模型创建失败:', error);
      throw new DatabaseError(`AI模型创建失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID查找AI模型
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM ai_models WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      const model = new AIModel(rows[0]);
      
      // 解析JSON配置
      if (typeof model.model_config === 'string') {
        try {
          model.model_config = JSON.parse(model.model_config);
        } catch (e) {
          model.model_config = {};
        }
      }
      
      return model;
    } catch (error) {
      logger.error('根据ID查找AI模型失败:', error);
      throw new DatabaseError(`查找AI模型失败: ${error.message}`, error);
    }
  }

  /**
   * 更新AI模型（支持流式输出配置）
   */
  async update(updateData) {
    try {
      const { 
        display_name, 
        api_key,
        api_endpoint, 
        model_config, 
        stream_enabled, // 🆕 流式输出开关
        credits_per_chat,
        is_active, 
        sort_order 
      } = updateData;
      
      const sql = `
        UPDATE ai_models 
        SET display_name = ?, api_key = ?, api_endpoint = ?, 
            model_config = ?, stream_enabled = ?, credits_per_chat = ?, is_active = ?, 
            sort_order = ?, test_status = 'untested', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [
        display_name || this.display_name,
        api_key !== undefined ? api_key : this.api_key,
        api_endpoint !== undefined ? api_endpoint : this.api_endpoint,
        model_config ? JSON.stringify(model_config) : JSON.stringify(this.model_config),
        stream_enabled !== undefined ? stream_enabled : this.stream_enabled, // 🆕 流式配置
        credits_per_chat !== undefined ? credits_per_chat : this.credits_per_chat,
        is_active !== undefined ? is_active : this.is_active,
        sort_order !== undefined ? sort_order : this.sort_order,
        this.id
      ]);

      logger.info('AI模型更新成功', { 
        modelId: this.id,
        stream_enabled: stream_enabled !== undefined ? stream_enabled : this.stream_enabled,
        credits_per_chat: credits_per_chat !== undefined ? credits_per_chat : this.credits_per_chat
      });
    } catch (error) {
      logger.error('AI模型更新失败:', error);
      throw new DatabaseError(`AI模型更新失败: ${error.message}`, error);
    }
  }

  /**
   * 删除AI模型
   */
  async delete() {
    try {
      const sql = 'DELETE FROM ai_models WHERE id = ?';
      await dbConnection.query(sql, [this.id]);

      logger.info('AI模型删除成功', { 
        modelId: this.id,
        modelName: this.name
      });
    } catch (error) {
      logger.error('AI模型删除失败:', error);
      throw new DatabaseError(`AI模型删除失败: ${error.message}`, error);
    }
  }

  /**
   * 更新测试状态
   */
  async updateTestStatus(status, message = null) {
    try {
      const sql = `
        UPDATE ai_models 
        SET test_status = ?, last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [status, this.id]);
      
      this.test_status = status;
      this.last_tested_at = new Date();
      
      logger.info('AI模型测试状态更新', { 
        modelId: this.id, 
        status, 
        message 
      });
    } catch (error) {
      logger.error('AI模型测试状态更新失败:', error);
      throw new DatabaseError(`测试状态更新失败: ${error.message}`, error);
    }
  }

  /**
   * 测试AI模型连通性
   */
  async testConnection() {
    try {
      const axios = require('axios');
      
      if (!this.api_key || !this.api_endpoint) {
        await this.updateTestStatus('failed', 'API密钥或端点未配置');
        return { success: false, message: 'API密钥或端点未配置' };
      }

      // 构造测试请求 - 移除maxToken限制
      const testPayload = {
        model: this.name,
        messages: [
          { role: 'user', content: 'Hello, please respond with a short greeting.' }
        ],
        temperature: 0.7,
        stream: false // 测试时不使用流式，避免复杂处理
      };

      const response = await axios.post(
        this.api_endpoint.endsWith('/chat/completions') ? 
          this.api_endpoint : 
          `${this.api_endpoint}/chat/completions`,
        testPayload,
        {
          headers: {
            'Authorization': `Bearer ${this.api_key}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.status === 200 && response.data.choices) {
        await this.updateTestStatus('success', '连通性测试成功');
        logger.info('AI模型连通性测试成功', { 
          modelId: this.id, 
          modelName: this.name 
        });
        return { success: true, message: '连通性测试成功' };
      } else {
        await this.updateTestStatus('failed', 'API响应格式异常');
        return { success: false, message: 'API响应格式异常' };
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message || '连通性测试失败';
      await this.updateTestStatus('failed', errorMsg);
      
      logger.warn('AI模型连通性测试失败', { 
        modelId: this.id, 
        modelName: this.name,
        error: errorMsg 
      });
      return { 
        success: false, 
        message: errorMsg
      };
    }
  }

  /**
   * 获取积分消费配置
   */
  getCreditsConfig() {
    return {
      credits_per_chat: this.credits_per_chat || 10,
      model_name: this.name,
      display_name: this.display_name,
      provider: this.provider
    };
  }

  /**
   * 获取流式输出配置（预留）
   */
  getStreamConfig() {
    return {
      stream_enabled: this.stream_enabled,
      model_name: this.name,
      provider: this.provider
    };
  }

  /**
   * 检查是否支持流式输出
   */
  isStreamEnabled() {
    return this.stream_enabled === true;
  }

  /**
   * 获取模型的默认配置 - 移除maxToken限制
   */
  getDefaultConfig() {
    const defaultConfig = {
      temperature: 0.7,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0
    };

    return {
      ...defaultConfig,
      ...this.model_config
    };
  }

  /**
   * 转换为JSON（隐藏敏感信息）
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      display_name: this.display_name,
      api_key: this.api_key ? '***已配置***' : null,
      provider: this.provider,
      api_endpoint: this.api_endpoint ? '***已配置***' : null,
      model_config: this.model_config,
      stream_enabled: this.stream_enabled, // 🆕 流式输出状态
      credits_per_chat: this.credits_per_chat,
      is_active: this.is_active,
      sort_order: this.sort_order,
      test_status: this.test_status,
      last_tested_at: this.last_tested_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * 获取完整信息（包含敏感数据，仅供内部使用）
   */
  toFullJSON() {
    return {
      id: this.id,
      name: this.name,
      display_name: this.display_name,
      api_key: this.api_key,
      provider: this.provider,
      api_endpoint: this.api_endpoint,
      model_config: this.model_config,
      stream_enabled: this.stream_enabled, // 🆕 流式输出状态
      credits_per_chat: this.credits_per_chat,
      is_active: this.is_active,
      sort_order: this.sort_order,
      test_status: this.test_status,
      last_tested_at: this.last_tested_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = AIModel;
