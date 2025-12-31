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
 * - category_ids: 分类ID数组（支持1-3个分类）
 * - credits_per_use: 每次使用扣减积分（0-9999）
 * - is_published: 是否发布
 * 
 * 版本：v2.0.0
 * 更新：
 * - 2025-12-30 v2.0.0 支持多分类(category_ids)和应用积分(credits_per_use)
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
    
    // MySQL的decimal类型在Node.js中可能返回字符串，必须用parseFloat转换
    const parsedTemperature = parseFloat(data.temperature);
    this.temperature = !isNaN(parsedTemperature) ? parsedTemperature : 0.7;
    
    // 上下文长度
    const parsedContextLength = parseInt(data.context_length);
    this.context_length = !isNaN(parsedContextLength) ? parsedContextLength : 10;
    
    this.model_id = data.model_id || null;
    this.is_stream = data.is_stream !== undefined ? data.is_stream : 1;
    
    // v2.0.0 兼容处理：category_ids是JSON数组，category是旧的单值字段
    this.category_ids = this._parseCategoryIds(data.category_ids);
    this.category = data.category || null; // 保留旧字段用于兼容
    
    // v2.0.0 新增：每次使用扣减积分
    const parsedCredits = parseInt(data.credits_per_use);
    this.credits_per_use = !isNaN(parsedCredits) ? Math.max(0, Math.min(9999, parsedCredits)) : 0;
    
    this.is_published = data.is_published !== undefined ? data.is_published : 0;
    
    // 排序
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
    
    // v2.0.0 分类详情（JOIN查询时填充）
    this.categories = data.categories || [];
  }

  /**
   * 解析category_ids字段
   * @private
   */
  _parseCategoryIds(categoryIds) {
    if (!categoryIds) return [];
    if (Array.isArray(categoryIds)) return categoryIds;
    if (typeof categoryIds === 'string') {
      try {
        return JSON.parse(categoryIds);
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * 根据ID查找智能应用
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
      
      const app = new SmartApp(rows[0]);
      
      // 获取分类详情
      if (app.category_ids && app.category_ids.length > 0) {
        app.categories = await SmartApp.getCategoriesByIds(app.category_ids);
      }
      
      return app;
    } catch (error) {
      logger.error('根据ID查找智能应用失败:', error);
      throw new DatabaseError(`查找智能应用失败: ${error.message}`, error);
    }
  }

  /**
   * 根据分类ID数组获取分类详情
   */
  static async getCategoriesByIds(ids) {
    if (!ids || ids.length === 0) return [];
    try {
      const placeholders = ids.map(() => '?').join(',');
      const sql = `SELECT * FROM smart_app_categories WHERE id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order`;
      const { rows } = await dbConnection.query(sql, ids);
      return rows;
    } catch (error) {
      logger.error('获取分类详情失败:', error);
      return [];
    }
  }

  /**
   * 获取所有智能应用（管理员用）
   */
  static async findAll(options = {}) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        category_id = null, 
        is_published = null,
        keyword = null 
      } = options;
      
      // 构建WHERE条件
      const conditions = [];
      const params = [];
      
      // v2.0.0 按分类ID筛选（使用JSON_CONTAINS）
      if (category_id) {
        conditions.push('JSON_CONTAINS(sa.category_ids, ?)');
        params.push(JSON.stringify(parseInt(category_id)));
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
      
      // 批量获取分类详情
      const apps = rows.map(row => new SmartApp(row));
      await SmartApp.populateCategories(apps);
      
      return {
        apps,
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
   * 批量填充分类信息
   */
  static async populateCategories(apps) {
    if (!apps || apps.length === 0) return;
    
    // 收集所有分类ID
    const allCategoryIds = new Set();
    apps.forEach(app => {
      (app.category_ids || []).forEach(id => allCategoryIds.add(id));
    });
    
    if (allCategoryIds.size === 0) return;
    
    // 一次性查询所有分类
    const categories = await SmartApp.getCategoriesByIds([...allCategoryIds]);
    const categoryMap = new Map(categories.map(c => [c.id, c]));
    
    // 填充到每个应用
    apps.forEach(app => {
      app.categories = (app.category_ids || [])
        .map(id => categoryMap.get(id))
        .filter(Boolean);
    });
  }

  /**
   * 获取已发布的智能应用（用户端用）
   */
  static async findPublished(options = {}) {
    try {
      const { 
        page = 1, 
        limit = 50, 
        category_id = null,
        keyword = null 
      } = options;
      
      // 构建WHERE条件
      const conditions = ['sa.is_published = 1'];
      const params = [];
      
      // v2.0.0 按分类ID筛选
      if (category_id) {
        conditions.push('JSON_CONTAINS(sa.category_ids, ?)');
        params.push(JSON.stringify(parseInt(category_id)));
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
      
      // 批量获取分类详情
      const apps = rows.map(row => new SmartApp(row));
      await SmartApp.populateCategories(apps);
      
      return {
        apps,
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
        category_ids = [],
        credits_per_use = 0,
        is_published = 0,
        sort_order = 0,
        creator_id
      } = appData;
      
      // 验证必填字段
      if (!name || !model_id || !creator_id) {
        throw new Error('应用名称、模型ID和创建者ID为必填项');
      }
      
      // 验证温度范围0-2
      const parsedTemp = parseFloat(temperature);
      const validTemperature = isNaN(parsedTemp) ? 0.7 : Math.max(0, Math.min(2, parsedTemp));
      
      // 验证上下文条数范围
      const parsedContext = parseInt(context_length);
      const validContextLength = isNaN(parsedContext) ? 10 : Math.max(0, Math.min(1000, parsedContext));
      
      // v2.0.0 验证分类数量（1-3个）
      const validCategoryIds = Array.isArray(category_ids) ? category_ids.slice(0, 3) : [];
      
      // v2.0.0 验证积分范围（0-9999）
      const parsedCredits = parseInt(credits_per_use);
      const validCredits = isNaN(parsedCredits) ? 0 : Math.max(0, Math.min(9999, parsedCredits));
      
      const sql = `
        INSERT INTO smart_apps 
        (name, description, icon, system_prompt, temperature, context_length, 
         model_id, is_stream, category_ids, credits_per_use, is_published, sort_order, creator_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(validCategoryIds),
        validCredits,
        is_published ? 1 : 0,
        sort_order,
        creator_id
      ]);
      
      logger.info('智能应用创建成功', {
        appId: rows.insertId,
        name,
        categoryIds: validCategoryIds,
        creditsPerUse: validCredits
      });
      
      return await SmartApp.findById(rows.insertId);
    } catch (error) {
      logger.error('创建智能应用失败:', error);
      throw new DatabaseError(`创建智能应用失败: ${error.message}`, error);
    }
  }

  /**
   * 更新智能应用
   */
  async update(updateData) {
    try {
      const fields = [];
      const values = [];
      
      // 允许更新的字段
      const allowedFields = [
        'name', 'description', 'icon', 'system_prompt', 
        'temperature', 'context_length', 'model_id', 
        'is_stream', 'category_ids', 'credits_per_use', 'is_published', 'sort_order'
      ];
      
      allowedFields.forEach(field => {
        if (updateData.hasOwnProperty(field) && updateData[field] !== undefined) {
          fields.push(`${field} = ?`);
          
          if (field === 'temperature') {
            const temp = parseFloat(updateData[field]);
            values.push(isNaN(temp) ? 0.7 : Math.max(0, Math.min(2, temp)));
          } else if (field === 'context_length') {
            const ctx = parseInt(updateData[field]);
            values.push(isNaN(ctx) ? 10 : Math.max(0, Math.min(1000, ctx)));
          } else if (field === 'is_stream' || field === 'is_published') {
            values.push(updateData[field] ? 1 : 0);
          } else if (field === 'category_ids') {
            // v2.0.0 分类ID数组，限制最多3个
            const ids = Array.isArray(updateData[field]) ? updateData[field].slice(0, 3) : [];
            values.push(JSON.stringify(ids));
          } else if (field === 'credits_per_use') {
            // v2.0.0 积分范围0-9999
            const credits = parseInt(updateData[field]);
            values.push(isNaN(credits) ? 0 : Math.max(0, Math.min(9999, credits)));
          } else {
            values.push(updateData[field]);
          }
        }
      });
      
      if (fields.length === 0) {
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
      logger.warn('更新使用次数失败:', { appId: this.id, error: error.message });
    }
  }

  /**
   * 获取所有分类（从数据库）
   */
  static async getCategories() {
    try {
      const sql = `
        SELECT * FROM smart_app_categories 
        WHERE is_active = 1 
        ORDER BY sort_order ASC, id ASC
      `;
      const { rows } = await dbConnection.query(sql);
      return rows;
    } catch (error) {
      logger.error('获取分类列表失败:', error);
      throw new DatabaseError(`获取分类列表失败: ${error.message}`, error);
    }
  }

  /**
   * 获取分类统计（按分类ID）
   */
  static async getCategoryStats() {
    try {
      // 使用子查询统计每个分类的应用数量
      const sql = `
        SELECT 
          sac.id,
          sac.name,
          sac.color,
          (
            SELECT COUNT(*) 
            FROM smart_apps sa 
            WHERE sa.is_published = 1 
              AND JSON_CONTAINS(sa.category_ids, CAST(sac.id AS JSON))
          ) as count
        FROM smart_app_categories sac
        WHERE sac.is_active = 1
        ORDER BY sac.sort_order ASC
      `;
      const { rows } = await dbConnection.query(sql);
      return rows;
    } catch (error) {
      logger.error('获取分类统计失败:', error);
      throw new DatabaseError(`获取分类统计失败: ${error.message}`, error);
    }
  }

  /**
   * 创建分类
   */
  static async createCategory(data) {
    try {
      const { name, color = '#1677ff', sort_order = 0 } = data;
      
      if (!name) {
        throw new Error('分类名称不能为空');
      }
      
      const sql = `
        INSERT INTO smart_app_categories (name, color, sort_order)
        VALUES (?, ?, ?)
      `;
      const { rows } = await dbConnection.query(sql, [name, color, sort_order]);
      
      logger.info('分类创建成功', { categoryId: rows.insertId, name });
      
      return { id: rows.insertId, name, color, sort_order, is_active: 1 };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('分类名称已存在');
      }
      logger.error('创建分类失败:', error);
      throw new DatabaseError(`创建分类失败: ${error.message}`, error);
    }
  }

  /**
   * 更新分类
   */
  static async updateCategory(id, data) {
    try {
      const fields = [];
      const values = [];
      
      if (data.name !== undefined) {
        fields.push('name = ?');
        values.push(data.name);
      }
      if (data.color !== undefined) {
        fields.push('color = ?');
        values.push(data.color);
      }
      if (data.sort_order !== undefined) {
        fields.push('sort_order = ?');
        values.push(data.sort_order);
      }
      if (data.is_active !== undefined) {
        fields.push('is_active = ?');
        values.push(data.is_active ? 1 : 0);
      }
      
      if (fields.length === 0) {
        return null;
      }
      
      values.push(id);
      
      const sql = `UPDATE smart_app_categories SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      await dbConnection.query(sql, values);
      
      logger.info('分类更新成功', { categoryId: id });
      
      // 返回更新后的数据
      const { rows } = await dbConnection.query('SELECT * FROM smart_app_categories WHERE id = ?', [id]);
      return rows[0] || null;
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('分类名称已存在');
      }
      logger.error('更新分类失败:', error);
      throw new DatabaseError(`更新分类失败: ${error.message}`, error);
    }
  }

  /**
   * 删除分类
   */
  static async deleteCategory(id) {
    try {
      // 检查是否有应用使用此分类
      const checkSql = `
        SELECT COUNT(*) as count FROM smart_apps 
        WHERE JSON_CONTAINS(category_ids, ?)
      `;
      const { rows: checkRows } = await dbConnection.query(checkSql, [JSON.stringify(parseInt(id))]);
      
      if (checkRows[0].count > 0) {
        throw new Error(`该分类下有 ${checkRows[0].count} 个应用，请先移除应用的分类后再删除`);
      }
      
      const sql = 'DELETE FROM smart_app_categories WHERE id = ?';
      await dbConnection.query(sql, [id]);
      
      logger.info('分类删除成功', { categoryId: id });
      return true;
    } catch (error) {
      logger.error('删除分类失败:', error);
      throw new DatabaseError(`删除分类失败: ${error.message}`, error);
    }
  }

  /**
   * 转换为JSON（用户端）
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
      category_ids: this.category_ids,
      categories: this.categories,
      credits_per_use: this.credits_per_use,
      is_published: this.is_published,
      sort_order: this.sort_order,
      use_count: this.use_count,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * 转换为完整JSON（管理员端，包含系统提示词）
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
