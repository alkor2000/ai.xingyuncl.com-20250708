/**
 * HTML项目/文件夹模型
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class HtmlProject {
  /**
   * 创建项目或文件夹
   */
  static async create(data) {
    try {
      const {
        user_id,
        parent_id = null,
        name,
        path,
        type = 'page',
        description = null,
        tags = null,
        is_public = 0,
        password = null,
        sort_order = 0,
        is_default = 0
      } = data;

      const query = `
        INSERT INTO html_projects 
        (user_id, parent_id, name, path, type, description, tags, is_public, password, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        user_id,
        parent_id,
        name,
        path,
        type,
        description,
        tags ? JSON.stringify(tags) : null,
        is_public,
        password,
        sort_order
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建HTML项目失败:', error);
      throw error;
    }
  }

  /**
   * 安全地解析JSON字符串
   */
  static safeJsonParse(jsonString) {
    if (!jsonString) return null;
    
    try {
      // 如果已经是对象/数组，直接返回
      if (typeof jsonString === 'object') {
        return jsonString;
      }
      
      // 尝试直接解析
      return JSON.parse(jsonString);
    } catch (error) {
      // 如果解析失败，尝试修复常见问题
      try {
        // 处理可能的编码问题
        const fixed = jsonString.toString('utf8');
        return JSON.parse(fixed);
      } catch (secondError) {
        logger.warn('JSON解析失败，返回空数组:', jsonString);
        return [];
      }
    }
  }

  /**
   * 获取用户的项目列表（树形结构）
   */
  static async getUserProjects(userId, parentId = null) {
    try {
      const query = `
        SELECT 
          p.*,
          COUNT(DISTINCT hp.id) as page_count,
          COUNT(DISTINCT hr.id) as resource_count
        FROM html_projects p
        LEFT JOIN html_pages hp ON p.id = hp.project_id
        LEFT JOIN html_resources hr ON p.id = hr.project_id
        WHERE p.user_id = ? AND p.parent_id ${parentId ? '= ?' : 'IS NULL'}
        GROUP BY p.id
        ORDER BY p.type DESC, p.sort_order ASC, p.created_at DESC
      `;

      const params = parentId ? [userId, parentId] : [userId];
      const result = await dbConnection.query(query, params);

      // 递归获取子项目
      const projects = [];
      for (const row of result.rows) {
        const project = {
          ...row,
          tags: this.safeJsonParse(row.tags) || [],
          children: await this.getUserProjects(userId, row.id)
        };
        projects.push(project);
      }

      return projects;
    } catch (error) {
      logger.error('获取用户项目列表失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取项目
   */
  static async findById(id) {
    try {
      const query = 'SELECT * FROM html_projects WHERE id = ?';
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const project = result.rows[0];
      project.tags = this.safeJsonParse(project.tags) || [];
      return project;
    } catch (error) {
      logger.error('获取项目失败:', error);
      throw error;
    }
  }

  /**
   * 更新项目
   */
  static async update(id, data) {
    try {
      const allowedFields = ['name', 'description', 'tags', 'is_public', 'password', 'sort_order'];
      const fields = [];
      const values = [];

      for (const field of allowedFields) {
        if (data.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          if (field === 'tags') {
            values.push(data[field] ? JSON.stringify(data[field]) : null);
          } else {
            values.push(data[field]);
          }
        }
      }

      if (fields.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE html_projects SET ${fields.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);

      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新项目失败:', error);
      throw error;
    }
  }

  /**
   * 删除项目（级联删除子项目和页面）
   */
  static async delete(id) {
    try {
      const query = 'DELETE FROM html_projects WHERE id = ?';
      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除项目失败:', error);
      throw error;
    }
  }

  /**
   * 检查用户是否拥有项目
   */
  static async checkOwnership(id, userId) {
    try {
      const query = 'SELECT user_id FROM html_projects WHERE id = ?';
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return false;
      }

      return result.rows[0].user_id === userId;
    } catch (error) {
      logger.error('检查项目所有权失败:', error);
      return false;
    }
  }
}

module.exports = HtmlProject;
