/**
 * 智能应用数据模型
 * 功能：管理预设的AI应用配置，用户可一键使用无需配置
 * 
 * 核心字段：
 * - name: 应用名称
 * - description: 应用描述
 * - icon: 应用图标
 * - system_prompt: 系统提示词
 * - temperature: AI温度参数 (0-2)
 * - context_length: 上下文条数
 * - model_id: 关联的AI模型
 * - is_stream: 是否流式输出
 * - category: 应用分类
 * - is_published: 是否发布
 * 
 * 版本：v1.3.0
 * 更新：
 * - 2025-12-30 v1.1.0 修复温度为0无法保存的问题
 * - 2025-12-30 v1.2.0 温度范围改为0-2
 * - 2025-12-30 v1.3.0 修复从数据库读取decimal类型温度值的问题
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class SmartApp {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || null;
    this.description = data.description || null;
    this.icon = data.icon || null;
    this.system_prompt = data.system_prompt || null;
    
    /**
     * v1.3.0 修复：MySQL的decimal类型在Node.js中可能返回字符串
     * 必须用parseFloat转换，再用isNaN检查
     * 这样无论传入的是数字0、字符串"0"、字符串"0.0"都能正确处理
     */
    const parsedTemperature = parseFloat(data.temperature);
    this.temperature = !isNaN(parsedTemperature) ? parsedTemperature : 0.7;
    
    // 上下文长度也做类似处理
    const parsedContextLength = parseInt(data.context_length);
    this.context_length = !isNaN(parsedContextLength) ? parsedContextLength : 10;
    
    this.model_id = data.model_id || null;
    this.is_stream = data.is_stream !== undefined ? data.is_stream : 1;
    this.category = data.category || null;
    this.is_published = data.is_published !== undefined ? data.is_published : 0;
    
    // 排序也做类似处理
    const parsedSortOrder = parseInt(data.sort_order);
    this.sort_order = !isNaN(parsedSortOrder) ? parsedSortOrder : 0;
    
    this.use_count = data.use_count || 0;
    this.creator_id = data.creator_id || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    
    // 关联数据（JOIN查询时填充）
    this.model_name = data.model_name || null;
    this.model_display_name = data.model_display_name || null;
    this.creator_username = data.creator_username || null;
  }

  /**
   * 根据ID查找智能应用
   * @param {number} id - 应用ID
   * @returns {SmartApp|null} 应用实例或null
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT sa.*, 
               am.name as model_name, 
               am.display_name as model_display_name,
               u.username as creator_username
        FROM smart_apps sa
        LEFT JOIN ai_models am ON sa.model_id = am.id
        LEFT JOIN users u ON sa.creator_id = u.id
        WHERE sa.id = ?
      `;
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new SmartApp(rows[0]);
    } catch (error) {
      logger.error('根据ID查找智能应用失败:', error);
      throw new DatabaseError(`查找智能应用失败: ${error.message}`, error);
    }
  }

  /**
   * 获取所有智能应用（管理员用）
   * @param {Object} options - 查询选项
   * @returns {Object} 应用列表和分页信息
   */
  static async findAll(options = {}) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        category = null, 
        is_published = null,
        keyword = null 
      } = options;
      
      // 构建WHERE条件
      const conditions = [];
      const params = [];
      
      if (category) {
        conditions.push('sa.category = ?');
        params.push(category);
      }
      
      if (is_published !== null) {
        conditions.push('sa.is_published = ?');
        params.push(is_published);
      }
      
      if (keyword) {
        conditions.push('(sa.name LIKE ? OR sa.description LIKE ?)');
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM smart_apps sa ${whereClause}`;
      const { rows: countRows } = await dbConnection.query(countSql, params);
      const total = countRows[0].total;
      
      // 获取列表
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT sa.*, 
               am.name as model_name, 
               am.display_name as model_display_name,
               u.username as creator_username
        FROM smart_apps sa
        LEFT JOIN ai_models am ON sa.model_id = am.id
        LEFT JOIN users u ON sa.creator_id = u.id
        ${whereClause}
        ORDER BY sa.sort_order ASC, sa.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      const { rows } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);
      
      return {
        apps: rows.map(row => new SmartApp(row)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取智能应用列表失败:', error);
      throw new DatabaseError(`获取智能应用列表失败: ${error.message}`, error);
    }
  }

  /**
   * 获取已发布的智能应用（用户端用）
   * @param {Object} options - 查询选项
   * @returns {Object} 应用列表和分页信息
   */
  static async findPublished(options = {}) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        category = null,
        keyword = null 
      } = options;
      
      // 构建WHERE条件
      const conditions = ['sa.is_published = 1'];
      const params = [];
      
      if (category) {
        conditions.push('sa.category = ?');
        params.push(category);
      }
      
      if (keyword) {
        conditions.push('(sa.name LIKE ? OR sa.description LIKE ?)');
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      
      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      
      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM smart_apps sa ${whereClause}`;
      const { rows: countRows } = await dbConnection.query(countSql, params);
      const total = countRows[0].total;
      
      // 获取列表
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT sa.*, 
               am.name as model_name, 
               am.display_name as model_display_name
        FROM smart_apps sa
        LEFT JOIN ai_models am ON sa.model_id = am.id
        ${whereClause}
        ORDER BY sa.sort_order ASC, sa.use_count DESC, sa.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      const { rows } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);
      
      return {
        apps: rows.map(row => new SmartApp(row)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取已发布智能应用列表失败:', error);
      throw new DatabaseError(`获取已发布智能应用列表失败: ${error.message}`, error);
    }
  }

  /**
   * 创建新的智能应用
   * @param {Object} appData - 应用数据
   * @returns {SmartApp} 新创建的应用实例
   */
  static async create(appData) {
    try {
      const {
        name,
        description = null,
        icon = null,
        system_prompt = null,
        temperature = 0.7,
        context_length = 10,
        model_id,
        is_stream = 1,
        category = null,
        is_published = 0,
        sort_order = 0,
        creator_id
      } = appData;
      
      // 验证必填字段
      if (!name || !model_id || !creator_id) {
        throw new Error('应用名称、模型ID和创建者ID为必填项');
      }
      
      // 验证温度范围0-2，使用isNaN检查确保0值正确处理
      const parsedTemp = parseFloat(temperature);
      const validTemperature = isNaN(parsedTemp) ? 0.7 : Math.max(0, Math.min(2, parsedTemp));
      
      // 验证上下文条数范围
      const parsedContext = parseInt(context_length);
      const validContextLength = isNaN(parsedContext) ? 10 : Math.max(0, Math.min(1000, parsedContext));
      
      const sql = `
        INSERT INTO smart_apps 
        (name, description, icon, system_prompt, temperature, context_length, 
         model_id, is_stream, category, is_published, sort_order, creator_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const { rows } = await dbConnection.query(sql, [
        name,
        description,
        icon,
        system_prompt,
        validTemperature,
        validContextLength,
        model_id,
        is_stream ? 1 : 0,
        category,
        is_published ? 1 : 0,
        sort_order,
        creator_id
      ]);
      
      logger.info('智能应用创建成功', {
        appId: rows.insertId,
        name,
        temperature: validTemperature,
        modelId: model_id,
        creatorId: creator_id
      });
      
      return await SmartApp.findById(rows.insertId);
    } catch (error) {
      logger.error('创建智能应用失败:', error);
      throw new DatabaseError(`创建智能应用失败: ${error.message}`, error);
    }
  }

  /**
   * 更新智能应用
   * @param {Object} updateData - 更新数据
   * @returns {SmartApp} 更新后的应用实例
   */
  async update(updateData) {
    try {
      const fields = [];
      const values = [];
      
      // 允许更新的字段
      const allowedFields = [
        'name', 'description', 'icon', 'system_prompt', 
        'temperature', 'context_length', 'model_id', 
        'is_stream', 'category', 'is_published', 'sort_order'
      ];
      
      allowedFields.forEach(field => {
        if (updateData.hasOwnProperty(field) && updateData[field] !== undefined) {
          fields.push(`${field} = ?`);
          
          if (field === 'temperature') {
            // 验证温度范围0-2，使用isNaN检查确保0值正确处理
            const temp = parseFloat(updateData[field]);
            values.push(isNaN(temp) ? 0.7 : Math.max(0, Math.min(2, temp)));
          } else if (field === 'context_length') {
            // 验证上下文条数范围
            const ctx = parseInt(updateData[field]);
            values.push(isNaN(ctx) ? 10 : Math.max(0, Math.min(1000, ctx)));
          } else if (field === 'is_stream' || field === 'is_published') {
            // 布尔字段转换
            values.push(updateData[field] ? 1 : 0);
          } else {
            values.push(updateData[field]);
          }
        }
      });
      
      if (fields.length === 0) {
        logger.info('没有需要更新的字段', { appId: this.id });
        return this;
      }
      
      values.push(this.id);
      
      const sql = `UPDATE smart_apps SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      
      await dbConnection.query(sql, values);
      
      logger.info('智能应用更新成功', {
        appId: this.id,
        updatedFields: fields.map(f => f.split(' = ')[0])
      });
      
      return await SmartApp.findById(this.id);
    } catch (error) {
      logger.error('更新智能应用失败:', error);
      throw new DatabaseError(`更新智能应用失败: ${error.message}`, error);
    }
  }

  /**
   * 删除智能应用
   */
  async delete() {
    try {
      // 检查是否有关联的会话
      const checkSql = 'SELECT COUNT(*) as count FROM conversations WHERE smart_app_id = ?';
      const { rows: checkRows } = await dbConnection.query(checkSql, [this.id]);
      
      if (checkRows[0].count > 0) {
        // 有关联会话时，只解除关联而不阻止删除
        const unlinkSql = 'UPDATE conversations SET smart_app_id = NULL WHERE smart_app_id = ?';
        await dbConnection.query(unlinkSql, [this.id]);
        logger.info('已解除会话关联', { appId: this.id, conversationCount: checkRows[0].count });
      }
      
      const sql = 'DELETE FROM smart_apps WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      
      logger.info('智能应用删除成功', { appId: this.id, name: this.name });
    } catch (error) {
      logger.error('删除智能应用失败:', error);
      throw new DatabaseError(`删除智能应用失败: ${error.message}`, error);
    }
  }

  /**
   * 切换发布状态
   * @returns {SmartApp} 更新后的应用实例
   */
  async togglePublish() {
    try {
      const newStatus = this.is_published ? 0 : 1;
      
      const sql = 'UPDATE smart_apps SET is_published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      await dbConnection.query(sql, [newStatus, this.id]);
      
      logger.info('智能应用发布状态切换', {
        appId: this.id,
        name: this.name,
        newStatus: newStatus === 1 ? '已发布' : '未发布'
      });
      
      return await SmartApp.findById(this.id);
    } catch (error) {
      logger.error('切换发布状态失败:', error);
      throw new DatabaseError(`切换发布状态失败: ${error.message}`, error);
    }
  }

  /**
   * 增加使用次数
   */
  async incrementUseCount() {
    try {
      const sql = 'UPDATE smart_apps SET use_count = use_count + 1 WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      
      this.use_count += 1;
    } catch (error) {
      // 使用次数更新失败不影响主流程，只记录日志
      logger.warn('更新使用次数失败:', { appId: this.id, error: error.message });
    }
  }

  /**
   * 获取所有分类
   * @returns {Array} 分类列表
   */
  static async getCategories() {
    try {
      const sql = `
        SELECT * FROM smart_app_categories 
        WHERE is_active = 1 
        ORDER BY sort_order ASC
      `;
      const { rows } = await dbConnection.query(sql);
      return rows;
    } catch (error) {
      logger.error('获取分类列表失败:', error);
      throw new DatabaseError(`获取分类列表失败: ${error.message}`, error);
    }
  }

  /**
   * 获取分类统计
   * @returns {Array} 各分类的应用数量
   */
  static async getCategoryStats() {
    try {
      const sql = `
        SELECT 
          COALESCE(sa.category, '未分类') as category,
          COUNT(*) as count
        FROM smart_apps sa
        WHERE sa.is_published = 1
        GROUP BY sa.category
        ORDER BY count DESC
      `;
      const { rows } = await dbConnection.query(sql);
      return rows;
    } catch (error) {
      logger.error('获取分类统计失败:', error);
      throw new DatabaseError(`获取分类统计失败: ${error.message}`, error);
    }
  }

  /**
   * 检查是否启用流式输出
   * @returns {boolean}
   */
  isStreamEnabled() {
    return this.is_stream === 1 || this.is_stream === true;
  }

  /**
   * 获取对话配置（用于创建会话）
   * @returns {Object} 对话配置对象
   */
  getConversationConfig() {
    return {
      smart_app_id: this.id,
      model_name: this.model_name,
      system_prompt: this.system_prompt,
      context_length: this.context_length,
      ai_temperature: this.temperature,
      title: this.name
    };
  }

  /**
   * 转换为JSON（用户端）
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      temperature: this.temperature,
      context_length: this.context_length,
      model_id: this.model_id,
      model_name: this.model_name,
      model_display_name: this.model_display_name,
      is_stream: this.is_stream,
      category: this.category,
      is_published: this.is_published,
      sort_order: this.sort_order,
      use_count: this.use_count,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * 转换为完整JSON（管理员端，包含系统提示词）
   * @returns {Object}
   */
  toFullJSON() {
    return {
      ...this.toJSON(),
      system_prompt: this.system_prompt,
      creator_id: this.creator_id,
      creator_username: this.creator_username
    };
  }
}

module.exports = SmartApp;
