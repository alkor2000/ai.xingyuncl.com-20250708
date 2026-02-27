/**
 * AI模型数据模型 - 支持积分消费配置、流式输出、图片上传、文档上传、用户组分配和用户限制
 * 支持Azure OpenAI配置和免费模型（0积分）
 * v1.1修复：更新时api_key和api_endpoint留空保持原值的逻辑
 * v1.2新增：batchUpdateSortOrder 批量排序方法 - 2026-02-27
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
    this.stream_enabled = data.stream_enabled !== undefined ? data.stream_enabled : true;
    this.image_upload_enabled = data.image_upload_enabled !== undefined ? data.image_upload_enabled : false;
    this.document_upload_enabled = data.document_upload_enabled !== undefined ? data.document_upload_enabled : false;
    // 修复：正确处理0值，使用严格比较
    this.credits_per_chat = data.credits_per_chat !== undefined ? data.credits_per_chat : 10;
    this.is_active = data.is_active !== undefined ? data.is_active : true;
    this.sort_order = data.sort_order !== undefined ? data.sort_order : 0;
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
   * 根据用户组ID获取可用的AI模型
   */
  static async getAvailableModelsByGroup(groupId) {
    try {
      const sql = `
        SELECT m.* FROM ai_models m
        INNER JOIN ai_model_groups mg ON m.id = mg.model_id
        WHERE m.is_active = true AND mg.group_id = ?
        ORDER BY m.sort_order ASC, m.created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql, [groupId]);
      
      return rows.map(row => new AIModel(row));
    } catch (error) {
      logger.error('根据用户组获取可用AI模型失败:', error);
      throw new DatabaseError(`获取AI模型失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户实际可用的AI模型（考虑组权限和个人限制）
   */
  static async getUserAvailableModels(userId, groupId) {
    try {
      const sql = `
        SELECT DISTINCT m.* FROM ai_models m
        INNER JOIN ai_model_groups mg ON m.id = mg.model_id
        LEFT JOIN user_model_restrictions umr ON m.id = umr.model_id AND umr.user_id = ?
        WHERE m.is_active = true 
          AND mg.group_id = ?
          AND umr.id IS NULL
        ORDER BY m.sort_order ASC, m.created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql, [userId, groupId]);
      
      logger.info('获取用户可用AI模型', {
        userId,
        groupId,
        modelCount: rows.length
      });
      
      return rows.map(row => new AIModel(row));
    } catch (error) {
      logger.error('获取用户可用AI模型失败:', error);
      throw new DatabaseError(`获取用户可用模型失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户的模型限制列表
   */
  static async getUserModelRestrictions(userId) {
    try {
      const sql = `
        SELECT m.*, umr.created_at as restricted_at, u.username as restricted_by_username
        FROM user_model_restrictions umr
        INNER JOIN ai_models m ON umr.model_id = m.id
        LEFT JOIN users u ON umr.created_by = u.id
        WHERE umr.user_id = ?
        ORDER BY umr.created_at DESC
      `;
      
      const { rows } = await dbConnection.query(sql, [userId]);
      return rows;
    } catch (error) {
      logger.error('获取用户模型限制失败:', error);
      throw new DatabaseError(`获取用户模型限制失败: ${error.message}`, error);
    }
  }

  /**
   * 更新用户的模型限制
   */
  static async updateUserModelRestrictions(userId, restrictedModelIds, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      // 删除现有限制
      await transaction.query(
        'DELETE FROM user_model_restrictions WHERE user_id = ?',
        [userId]
      );
      
      // 添加新限制
      if (restrictedModelIds && restrictedModelIds.length > 0) {
        const values = restrictedModelIds.map(modelId => [userId, modelId, operatorId]);
        const placeholders = values.map(() => '(?, ?, ?)').join(', ');
        const flatValues = values.flat();
        
        await transaction.query(
          `INSERT INTO user_model_restrictions (user_id, model_id, created_by) VALUES ${placeholders}`,
          flatValues
        );
      }
      
      await transaction.commit();
      
      logger.info('用户模型限制更新成功', {
        userId,
        restrictedModelIds,
        operatorId
      });
      
      return true;
    } catch (error) {
      await transaction.rollback();
      logger.error('更新用户模型限制失败:', error);
      throw new DatabaseError(`更新用户模型限制失败: ${error.message}`, error);
    }
  }

  /**
   * 获取模型已分配的用户组
   */
  static async getModelGroups(modelId) {
    try {
      const sql = `
        SELECT g.*, mg.created_at as assigned_at
        FROM user_groups g
        INNER JOIN ai_model_groups mg ON g.id = mg.group_id
        WHERE mg.model_id = ?
        ORDER BY g.sort_order ASC, g.name ASC
      `;
      
      const { rows } = await dbConnection.query(sql, [modelId]);
      return rows;
    } catch (error) {
      logger.error('获取模型分配的用户组失败:', error);
      throw new DatabaseError(`获取模型分配组失败: ${error.message}`, error);
    }
  }

  /**
   * 更新模型的用户组分配
   */
  static async updateModelGroups(modelId, groupIds, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      // 删除现有分配
      await transaction.query(
        'DELETE FROM ai_model_groups WHERE model_id = ?',
        [modelId]
      );
      
      // 添加新分配
      if (groupIds && groupIds.length > 0) {
        const values = groupIds.map(groupId => [modelId, groupId, operatorId]);
        const placeholders = values.map(() => '(?, ?, ?)').join(', ');
        const flatValues = values.flat();
        
        await transaction.query(
          `INSERT INTO ai_model_groups (model_id, group_id, created_by) VALUES ${placeholders}`,
          flatValues
        );
      }
      
      await transaction.commit();
      
      logger.info('AI模型组分配更新成功', {
        modelId,
        groupIds,
        operatorId
      });
      
      return true;
    } catch (error) {
      await transaction.rollback();
      logger.error('更新模型组分配失败:', error);
      throw new DatabaseError(`更新模型组分配失败: ${error.message}`, error);
    }
  }

  /**
   * v1.2 批量更新模型排序（支持拖拽排序）
   * 使用CASE语句一次性更新，避免多次SQL调用
   * 
   * @param {Array<{id: number, sort_order: number}>} sortOrders - 排序配置数组
   */
  static async batchUpdateSortOrder(sortOrders) {
    try {
      if (!sortOrders || sortOrders.length === 0) return;

      // 构建CASE WHEN语句，一条SQL完成所有更新
      const ids = sortOrders.map(item => item.id);
      const caseClauses = sortOrders.map(item => `WHEN ${parseInt(item.id)} THEN ${parseInt(item.sort_order)}`).join(' ');
      const idPlaceholders = ids.map(() => '?').join(',');

      const sql = `
        UPDATE ai_models 
        SET sort_order = CASE id ${caseClauses} END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${idPlaceholders})
      `;

      await dbConnection.query(sql, ids);

      logger.info('批量更新模型排序成功', {
        modelCount: sortOrders.length,
        sortOrders: sortOrders.map(s => `${s.id}→${s.sort_order}`).join(', ')
      });
    } catch (error) {
      logger.error('批量更新模型排序失败:', error);
      throw new DatabaseError(`批量更新排序失败: ${error.message}`, error);
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
   * 创建新的AI模型配置（支持流式输出、图片上传、文档上传配置和免费模型）
   */
  static async create(modelData) {
    try {
      const { 
        name, 
        display_name, 
        api_key,
        api_endpoint, 
        model_config = {},
        stream_enabled = true,
        image_upload_enabled = false,
        document_upload_enabled = false,
        sort_order = 0 
      } = modelData;

      // 修复：正确处理credits_per_chat的0值
      const credits_per_chat = modelData.credits_per_chat !== undefined ? modelData.credits_per_chat : 10;

      // 根据模型名称自动推断提供商
      const provider = AIModel.inferProvider(name);

      const sql = `
        INSERT INTO ai_models (name, display_name, api_key, provider, api_endpoint, 
                              model_config, stream_enabled, image_upload_enabled, document_upload_enabled, 
                              credits_per_chat, sort_order, test_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested')
      `;
      
      const { rows } = await dbConnection.query(sql, [
        name, 
        display_name, 
        api_key,
        provider,
        api_endpoint, 
        JSON.stringify(model_config),
        stream_enabled,
        image_upload_enabled,
        document_upload_enabled,
        credits_per_chat,
        sort_order
      ]);

      logger.info('AI模型创建成功', { 
        modelId: rows.insertId, 
        name, 
        display_name,
        provider,
        stream_enabled,
        image_upload_enabled,
        document_upload_enabled,
        credits_per_chat,
        is_free_model: credits_per_chat === 0
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
   * 检查值是否为有效的非空字符串
   * 用于判断是否应该更新敏感字段（api_key、api_endpoint）
   * @param {*} value - 要检查的值
   * @returns {boolean} - 是否为有效的非空字符串
   */
  static isValidNonEmptyString(value) {
    return value !== undefined && value !== null && value !== '' && typeof value === 'string' && value.trim() !== '';
  }

  /**
   * 更新AI模型（支持流式输出、图片上传、文档上传配置和免费模型）
   * v1.1修复：api_key和api_endpoint留空时保持原值不变
   */
  async update(updateData) {
    try {
      const { 
        display_name, 
        api_key,
        api_endpoint, 
        model_config, 
        stream_enabled,
        image_upload_enabled,
        document_upload_enabled,
        credits_per_chat,
        is_active, 
        sort_order 
      } = updateData;
      
      // 🔥 修复：使用更严格的检查，确保只有真正有值的字符串才会更新
      // 空字符串、null、undefined都视为"不更新"
      const shouldUpdateApiKey = AIModel.isValidNonEmptyString(api_key);
      const shouldUpdateApiEndpoint = AIModel.isValidNonEmptyString(api_endpoint);
      
      // 记录更新决策日志
      logger.info('AI模型更新字段决策', {
        modelId: this.id,
        apiKeyProvided: api_key !== undefined,
        apiKeyValue: api_key ? `${String(api_key).substring(0, 5)}...` : '(empty)',
        apiKeyType: typeof api_key,
        shouldUpdateApiKey,
        apiEndpointProvided: api_endpoint !== undefined,
        apiEndpointValue: api_endpoint ? `${String(api_endpoint).substring(0, 20)}...` : '(empty)',
        apiEndpointType: typeof api_endpoint,
        shouldUpdateApiEndpoint
      });
      
      const sql = `
        UPDATE ai_models 
        SET display_name = ?, api_key = ?, api_endpoint = ?, 
            model_config = ?, stream_enabled = ?, image_upload_enabled = ?, document_upload_enabled = ?,
            credits_per_chat = ?, is_active = ?, 
            sort_order = ?, test_status = 'untested', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      // 计算最终使用的值
      const finalApiKey = shouldUpdateApiKey ? api_key : this.api_key;
      const finalApiEndpoint = shouldUpdateApiEndpoint ? api_endpoint : this.api_endpoint;
      
      await dbConnection.query(sql, [
        display_name !== undefined ? display_name : this.display_name,
        finalApiKey,
        finalApiEndpoint,
        model_config ? JSON.stringify(model_config) : JSON.stringify(this.model_config),
        stream_enabled !== undefined ? stream_enabled : this.stream_enabled,
        image_upload_enabled !== undefined ? image_upload_enabled : this.image_upload_enabled,
        document_upload_enabled !== undefined ? document_upload_enabled : this.document_upload_enabled,
        credits_per_chat !== undefined ? credits_per_chat : this.credits_per_chat,
        is_active !== undefined ? is_active : this.is_active,
        sort_order !== undefined ? sort_order : this.sort_order,
        this.id
      ]);

      const finalCredits = credits_per_chat !== undefined ? credits_per_chat : this.credits_per_chat;
      
      logger.info('AI模型更新成功', { 
        modelId: this.id,
        stream_enabled: stream_enabled !== undefined ? stream_enabled : this.stream_enabled,
        image_upload_enabled: image_upload_enabled !== undefined ? image_upload_enabled : this.image_upload_enabled,
        document_upload_enabled: document_upload_enabled !== undefined ? document_upload_enabled : this.document_upload_enabled,
        credits_per_chat: finalCredits,
        is_free_model: finalCredits === 0,
        apiKeyUpdated: shouldUpdateApiKey,
        apiEndpointUpdated: shouldUpdateApiEndpoint
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
   * 检测是否为Azure配置
   */
  isAzureConfig() {
    // 1. 通过provider判断
    if (this.provider === 'azure' || this.provider === 'azure-openai') {
      return true;
    }
    
    // 2. 通过api_key格式判断（包含|分隔符）
    if (this.api_key && this.api_key.includes('|')) {
      const parts = this.api_key.split('|');
      if (parts.length === 3) {
        return true;
      }
    }
    
    // 3. 通过endpoint判断
    if (this.api_endpoint === 'azure' || this.api_endpoint === 'use-from-key') {
      return true;
    }
    
    return false;
  }

  /**
   * 解析Azure配置字符串
   */
  parseAzureConfig() {
    if (!this.api_key || !this.api_key.includes('|')) {
      return null;
    }
    
    const parts = this.api_key.split('|');
    if (parts.length === 3) {
      return {
        apiKey: parts[0].trim(),
        endpoint: parts[1].trim(),
        apiVersion: parts[2].trim()
      };
    }
    return null;
  }

  /**
   * 测试AI模型连通性（支持Azure）
   */
  async testConnection() {
    try {
      const axios = require('axios');
      
      if (!this.api_key) {
        await this.updateTestStatus('failed', 'API密钥未配置');
        return { success: false, message: 'API密钥未配置' };
      }

      // 检测是否为Azure配置
      if (this.isAzureConfig()) {
        logger.info('检测到Azure配置，使用Azure测试方法', {
          modelId: this.id,
          modelName: this.name
        });

        // 解析Azure配置
        const azureConfig = this.parseAzureConfig();
        if (!azureConfig) {
          await this.updateTestStatus('failed', 'Azure配置格式错误');
          return { success: false, message: 'Azure配置格式错误，应为: api_key|endpoint|api_version' };
        }

        const { apiKey, endpoint, apiVersion } = azureConfig;

        // 从model.name提取deployment名称
        let deploymentName = this.name;
        if (this.name.includes('/')) {
          const parts = this.name.split('/');
          deploymentName = parts[parts.length - 1];
        }

        // 构造Azure特定的URL
        const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

        logger.info('测试Azure连接', {
          deployment: deploymentName,
          endpoint: baseUrl,
          apiVersion: apiVersion
        });

        // 解析model_config获取测试温度
        let config = this.model_config;
        if (typeof config === 'string') {
          try {
            config = JSON.parse(config);
          } catch (e) {
            config = {};
          }
        }
        const testTemperature = config.test_temperature || 1;

        // 构造测试请求 - Azure不需要model字段
        const testPayload = {
          messages: [
            { role: 'user', content: 'Hello, please respond with a short greeting.' }
          ],
          temperature: testTemperature,
          stream: false
        };

        const response = await axios.post(azureUrl, testPayload, {
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });

        if (response.status === 200 && response.data.choices) {
          await this.updateTestStatus('success', '连通性测试成功');
          logger.info('Azure模型连通性测试成功', { 
            modelId: this.id, 
            modelName: this.name,
            deployment: deploymentName
          });
          return { success: true, message: '连通性测试成功' };
        } else {
          await this.updateTestStatus('failed', 'API响应格式异常');
          return { success: false, message: 'API响应格式异常' };
        }

      } else {
        // 标准OpenAI API测试
        if (!this.api_endpoint) {
          await this.updateTestStatus('failed', 'API端点未配置');
          return { success: false, message: 'API端点未配置' };
        }

        // 解析model_config
        let config = this.model_config;
        if (typeof config === 'string') {
          try {
            config = JSON.parse(config);
          } catch (e) {
            config = {};
          }
        }

        // 获取测试温度，默认为1
        const testTemperature = config.test_temperature || 1;

        logger.info('使用测试温度', {
          modelId: this.id,
          modelName: this.name,
          testTemperature
        });

        // 构造测试请求 - 使用配置的温度值
        const testPayload = {
          model: this.name,
          messages: [
            { role: 'user', content: 'Hello, please respond with a short greeting.' }
          ],
          temperature: testTemperature,
          stream: false
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
            modelName: this.name,
            testTemperature
          });
          return { success: true, message: '连通性测试成功' };
        } else {
          await this.updateTestStatus('failed', 'API响应格式异常');
          return { success: false, message: 'API响应格式异常' };
        }
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message || '连通性测试失败';
      await this.updateTestStatus('failed', errorMsg);
      
      logger.warn('AI模型连通性测试失败', { 
        modelId: this.id, 
        modelName: this.name,
        error: errorMsg,
        response: error.response?.data
      });
      return { 
        success: false, 
        message: errorMsg
      };
    }
  }

  /**
   * 获取积分消费配置（支持免费模型）
   */
  getCreditsConfig() {
    return {
      credits_per_chat: this.credits_per_chat !== undefined ? this.credits_per_chat : 10,
      is_free: this.credits_per_chat === 0,
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
    return this.stream_enabled === true || this.stream_enabled === 1;
  }

  /**
   * 检查是否支持图片上传
   */
  isImageUploadEnabled() {
    return this.image_upload_enabled === true || this.image_upload_enabled === 1;
  }

  /**
   * 检查是否支持文档上传
   */
  isDocumentUploadEnabled() {
    return this.document_upload_enabled === true || this.document_upload_enabled === 1;
  }

  /**
   * 检查是否为免费模型
   */
  isFreeModel() {
    return this.credits_per_chat === 0;
  }

  /**
   * 获取模型的默认配置 - 移除maxToken限制
   */
  getDefaultConfig() {
    // 解析model_config
    let config = this.model_config;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch (e) {
        config = {};
      }
    }

    const defaultConfig = {
      temperature: 0.7,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0
    };

    return {
      ...defaultConfig,
      ...config
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
      stream_enabled: this.stream_enabled,
      image_upload_enabled: this.image_upload_enabled,
      document_upload_enabled: this.document_upload_enabled,
      credits_per_chat: this.credits_per_chat,
      is_free: this.credits_per_chat === 0,
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
      stream_enabled: this.stream_enabled,
      image_upload_enabled: this.image_upload_enabled,
      document_upload_enabled: this.document_upload_enabled,
      credits_per_chat: this.credits_per_chat,
      is_free: this.credits_per_chat === 0,
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
