/**
 * Agent执行记录模型
 * 管理工作流的执行历史
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class AgentExecution {
  /**
   * 创建执行记录
   */
  static async create(executionData) {
    try {
      const {
        workflow_id,
        user_id,
        input_data = null,
        status = 'running'
      } = executionData;

      const query = `
        INSERT INTO agent_executions (
          workflow_id, user_id, input_data, status
        ) VALUES (?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        workflow_id,
        user_id,
        input_data ? JSON.stringify(input_data) : null,
        status
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建执行记录失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID查找执行记录
   */
  static async findById(id) {
    try {
      const query = `
        SELECT 
          e.*,
          w.name as workflow_name,
          u.username
        FROM agent_executions e
        LEFT JOIN agent_workflows w ON e.workflow_id = w.id
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.id = ?
      `;

      const result = await dbConnection.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      const execution = result.rows[0];

      // 解析 JSON 字段
      ['input_data', 'output_data', 'execution_log'].forEach(field => {
        if (execution[field] && typeof execution[field] === 'string') {
          try {
            execution[field] = JSON.parse(execution[field]);
          } catch (e) {
            logger.warn(`解析 ${field} 失败:`, e.message);
          }
        }
      });

      return execution;
    } catch (error) {
      logger.error('查找执行记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的执行历史
   */
  static async findByUserId(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        workflow_id = null,
        status = null
      } = options;

      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const offset = (pageInt - 1) * limitInt;

      // 构建查询条件
      let whereConditions = ['e.user_id = ?'];
      const params = [userId];

      if (workflow_id) {
        whereConditions.push('e.workflow_id = ?');
        params.push(workflow_id);
      }

      if (status) {
        whereConditions.push('e.status = ?');
        params.push(status);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM agent_executions e
        WHERE ${whereClause}
      `;

      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      // 获取数据
      const dataQuery = `
        SELECT 
          e.id,
          e.workflow_id,
          e.status,
          e.total_credits_used,
          e.started_at,
          e.completed_at,
          e.duration_ms,
          w.name as workflow_name
        FROM agent_executions e
        LEFT JOIN agent_workflows w ON e.workflow_id = w.id
        WHERE ${whereClause}
        ORDER BY e.started_at DESC
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
      logger.error('获取用户执行历史失败:', error);
      throw error;
    }
  }

  /**
   * 更新执行记录
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'output_data', 'execution_log', 'status', 'total_credits_used',
        'error_message', 'completed_at', 'duration_ms'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);

          if (['output_data', 'execution_log'].includes(field) && typeof updateData[field] === 'object') {
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
      const query = `UPDATE agent_executions SET ${updates.join(', ')} WHERE id = ?`;

      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新执行记录失败:', error);
      throw error;
    }
  }

  /**
   * 删除执行记录
   */
  static async delete(id, userId) {
    try {
      const query = `DELETE FROM agent_executions WHERE id = ? AND user_id = ?`;
      const result = await dbConnection.query(query, [id, userId]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除执行记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户执行统计
   */
  static async getUserStats(userId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running_count,
          SUM(total_credits_used) as total_credits,
          SUM(CASE WHEN DATE(started_at) = CURDATE() THEN 1 ELSE 0 END) as today_count
        FROM agent_executions
        WHERE user_id = ?
      `;

      const result = await dbConnection.query(query, [userId]);

      return result.rows[0] || {
        total_count: 0,
        success_count: 0,
        failed_count: 0,
        running_count: 0,
        total_credits: 0,
        today_count: 0
      };
    } catch (error) {
      logger.error('获取执行统计失败:', error);
      throw error;
    }
  }

  /**
   * 取消执行
   */
  static async cancel(id, userId) {
    try {
      const query = `
        UPDATE agent_executions 
        SET status = 'cancelled', completed_at = NOW()
        WHERE id = ? AND user_id = ? AND status = 'running'
      `;

      const result = await dbConnection.query(query, [id, userId]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('取消执行失败:', error);
      throw error;
    }
  }
}

module.exports = AgentExecution;
