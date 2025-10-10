/**
 * 日历提示词模板Model - 支持多模板管理
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class CalendarPromptTemplate {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || null;
    this.prompt = data.prompt || null;
    this.description = data.description || null;
    this.is_default = data.is_default || false;
    this.display_order = data.display_order || 0;
    this.is_active = data.is_active !== undefined ? data.is_active : true;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 获取所有活跃模板
   */
  static async getAll() {
    try {
      const sql = `
        SELECT * FROM calendar_prompt_templates 
        WHERE is_active = TRUE 
        ORDER BY display_order ASC, created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql);
      return rows.map(row => new CalendarPromptTemplate(row));
    } catch (error) {
      logger.error('获取日历模板失败:', error);
      throw new DatabaseError(`获取日历模板失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID获取模板
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM calendar_prompt_templates WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new CalendarPromptTemplate(rows[0]);
    } catch (error) {
      logger.error('根据ID查找日历模板失败:', error);
      throw new DatabaseError(`查找日历模板失败: ${error.message}`, error);
    }
  }

  /**
   * 获取默认模板
   */
  static async getDefault() {
    try {
      const sql = 'SELECT * FROM calendar_prompt_templates WHERE is_default = TRUE AND is_active = TRUE LIMIT 1';
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0) {
        // 如果没有默认模板，返回第一个活跃模板
        const allTemplates = await CalendarPromptTemplate.getAll();
        return allTemplates[0] || null;
      }
      
      return new CalendarPromptTemplate(rows[0]);
    } catch (error) {
      logger.error('获取默认日历模板失败:', error);
      throw new DatabaseError(`获取默认日历模板失败: ${error.message}`, error);
    }
  }

  /**
   * 创建新模板
   */
  static async create(data) {
    try {
      const { name, prompt, description, is_default, display_order, is_active } = data;
      
      if (!name || !prompt) {
        throw new ValidationError('模板名称和提示词不能为空');
      }
      
      // 如果设置为默认，先取消其他模板的默认状态
      if (is_default) {
        await dbConnection.query('UPDATE calendar_prompt_templates SET is_default = FALSE');
      }
      
      const sql = `
        INSERT INTO calendar_prompt_templates 
        (name, prompt, description, is_default, display_order, is_active) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const { rows } = await dbConnection.query(sql, [
        name,
        prompt,
        description || null,
        is_default || false,
        display_order || 0,
        is_active !== undefined ? is_active : true
      ]);
      
      logger.info('日历模板创建成功', { templateId: rows.insertId, name });
      
      return await CalendarPromptTemplate.findById(rows.insertId);
    } catch (error) {
      logger.error('创建日历模板失败:', error);
      throw new DatabaseError(`创建日历模板失败: ${error.message}`, error);
    }
  }

  /**
   * 更新模板
   */
  async update(data) {
    try {
      const { name, prompt, description, is_default, display_order, is_active } = data;
      
      // 如果设置为默认，先取消其他模板的默认状态
      if (is_default && !this.is_default) {
        await dbConnection.query('UPDATE calendar_prompt_templates SET is_default = FALSE WHERE id != ?', [this.id]);
      }
      
      const sql = `
        UPDATE calendar_prompt_templates 
        SET name = ?, prompt = ?, description = ?, is_default = ?, 
            display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [
        name !== undefined ? name : this.name,
        prompt !== undefined ? prompt : this.prompt,
        description !== undefined ? description : this.description,
        is_default !== undefined ? is_default : this.is_default,
        display_order !== undefined ? display_order : this.display_order,
        is_active !== undefined ? is_active : this.is_active,
        this.id
      ]);
      
      logger.info('日历模板更新成功', { templateId: this.id });
    } catch (error) {
      logger.error('更新日历模板失败:', error);
      throw new DatabaseError(`更新日历模板失败: ${error.message}`, error);
    }
  }

  /**
   * 删除模板
   */
  async delete() {
    try {
      // 不允许删除默认模板
      if (this.is_default) {
        throw new ValidationError('不能删除默认模板');
      }
      
      const sql = 'DELETE FROM calendar_prompt_templates WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      
      logger.info('日历模板删除成功', { templateId: this.id });
    } catch (error) {
      logger.error('删除日历模板失败:', error);
      throw new DatabaseError(`删除日历模板失败: ${error.message}`, error);
    }
  }

  /**
   * 设置为默认模板
   */
  async setAsDefault() {
    try {
      // 先取消其他模板的默认状态
      await dbConnection.query('UPDATE calendar_prompt_templates SET is_default = FALSE');
      
      // 设置当前模板为默认
      await dbConnection.query('UPDATE calendar_prompt_templates SET is_default = TRUE WHERE id = ?', [this.id]);
      
      this.is_default = true;
      
      logger.info('默认模板设置成功', { templateId: this.id });
    } catch (error) {
      logger.error('设置默认模板失败:', error);
      throw new DatabaseError(`设置默认模板失败: ${error.message}`, error);
    }
  }

  /**
   * 替换模板变量
   */
  renderPrompt(variables) {
    let rendered = this.prompt;
    
    // 替换所有变量
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      rendered = rendered.replace(new RegExp(placeholder, 'g'), value);
    });
    
    return rendered;
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      prompt: this.prompt,
      description: this.description,
      is_default: this.is_default,
      display_order: this.display_order,
      is_active: this.is_active,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = CalendarPromptTemplate;
