/**
 * AI工作流模型
 * 管理用户创建的工作流
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class AgentWorkflow {
  /**
   * 创建工作流
   */
  static async create(workflowData) {
    try {
      const {
        user_id,
        name,
        description = null,
        flow_data,
        is_published = false,
        version = 1
      } = workflowData;

      const query = `
        INSERT INTO agent_workflows (
          user_id, name, description, flow_data, is_published, version
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        user_id,
        name,
        description,
        JSON.stringify(flow_data),
        is_published,
        version
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建工作流失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID查找工作流
   */
  static async findById(id) {
    try {
      const query = `
        SELECT 
          w.*,
          u.username,
          u.email
        FROM agent_workflows w
        LEFT JOIN users u ON w.user_id = u.id
        WHERE w.id = ?
      `;

      const result = await dbConnection.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      const workflow = result.rows[0];

      // 解析 JSON 字段
      if (typeof workflow.flow_data === 'string') {
        workflow.flow_data = JSON.parse(workflow.flow_data);
      }

      return workflow;
    } catch (error) {
      logger.error('查找工作流失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的工作流列表
   */
  static async findByUserId(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        is_published = null
      } = options;

      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const offset = (pageInt - 1) * limitInt;

      // 构建查询条件
      let whereConditions = ['w.user_id = ?'];
      const params = [userId];

      if (is_published !== null && is_published !== undefined) {
        whereConditions.push('w.is_published = ?');
        params.push(is_published);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM agent_workflows w
        WHERE ${whereClause}
      `;

      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      // 获取数据
      const dataQuery = `
        SELECT 
          w.id,
          w.name,
          w.description,
          w.is_published,
          w.version,
          w.created_at,
          w.updated_at
        FROM agent_workflows w
        WHERE ${whereClause}
        ORDER BY w.updated_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;

      const dataResult = await dbConnection.query(dataQuery, params);

      return {
        data: dataResult.rows,
        pagination: {
          page: pageInt,
          limit: limitInt,
          total,
          totalPages: Math.ceil(total / limitInt)
        }
      };
    } catch (error) {
      logger.error('获取用户工作流列表失败:', error);
      throw error;
    }
  }

  /**
   * 更新工作流
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'name', 'description', 'flow_data', 'is_published', 'version'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);
          
          if (field === 'flow_data' && typeof updateData[field] === 'object') {
            values.push(JSON.stringify(updateData[field]));
          } else {
            values.push(updateData[field]);
          }
        }
      }

      if (updates.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE agent_workflows SET ${updates.join(', ')} WHERE id = ?`;

      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新工作流失败:', error);
      throw error;
    }
  }

  /**
   * 删除工作流
   */
  static async delete(id, userId) {
    try {
      const query = `DELETE FROM agent_workflows WHERE id = ? AND user_id = ?`;
      const result = await dbConnection.query(query, [id, userId]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除工作流失败:', error);
      throw error;
    }
  }

  /**
   * 发布/取消发布工作流
   */
  static async togglePublish(id, userId) {
    try {
      const query = `
        UPDATE agent_workflows 
        SET is_published = NOT is_published 
        WHERE id = ? AND user_id = ?
      `;

      const result = await dbConnection.query(query, [id, userId]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('切换工作流发布状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取工作流统计信息
   */
  static async getUserStats(userId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN is_published = 1 THEN 1 END) as published_count,
          COUNT(CASE WHEN is_published = 0 THEN 1 END) as draft_count
        FROM agent_workflows
        WHERE user_id = ?
      `;

      const result = await dbConnection.query(query, [userId]);

      return result.rows[0] || {
        total_count: 0,
        published_count: 0,
        draft_count: 0
      };
    } catch (error) {
      logger.error('获取工作流统计失败:', error);
      throw error;
    }
  }
}

module.exports = AgentWorkflow;
