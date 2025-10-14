/**
 * Agent节点类型模型
 * 管理节点类型配置（超级管理员管理）
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class AgentNodeType {
  /**
   * 获取所有激活的节点类型
   */
  static async findAllActive() {
    try {
      const query = `
        SELECT 
          id, type_key, name, category, icon, color, description,
          config_schema, credits_per_execution, max_inputs, max_outputs,
          is_active, display_order
        FROM agent_node_types
        WHERE is_active = 1
        ORDER BY display_order ASC, id ASC
      `;

      const result = await dbConnection.query(query);

      // 解析 JSON 字段
      return result.rows.map(nodeType => ({
        ...nodeType,
        config_schema: typeof nodeType.config_schema === 'string'
          ? JSON.parse(nodeType.config_schema)
          : nodeType.config_schema
      }));
    } catch (error) {
      logger.error('获取激活节点类型失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有节点类型（包括未激活的，管理员用）
   */
  static async findAll() {
    try {
      const query = `
        SELECT * FROM agent_node_types
        ORDER BY display_order ASC, id ASC
      `;

      const result = await dbConnection.query(query);

      return result.rows.map(nodeType => ({
        ...nodeType,
        config_schema: typeof nodeType.config_schema === 'string'
          ? JSON.parse(nodeType.config_schema)
          : nodeType.config_schema
      }));
    } catch (error) {
      logger.error('获取所有节点类型失败:', error);
      throw error;
    }
  }

  /**
   * 根据type_key查找节点类型
   */
  static async findByTypeKey(typeKey) {
    try {
      const query = `SELECT * FROM agent_node_types WHERE type_key = ?`;
      const result = await dbConnection.query(query, [typeKey]);

      if (result.rows.length === 0) {
        return null;
      }

      const nodeType = result.rows[0];

      // 解析 JSON 字段
      if (typeof nodeType.config_schema === 'string') {
        nodeType.config_schema = JSON.parse(nodeType.config_schema);
      }

      return nodeType;
    } catch (error) {
      logger.error('根据type_key查找节点类型失败:', error);
      throw error;
    }
  }

  /**
   * 创建节点类型（管理员）
   */
  static async create(nodeTypeData) {
    try {
      const {
        type_key,
        name,
        category = 'process',
        icon = 'NodeIndexOutlined',
        color = '#1890ff',
        description = null,
        config_schema = {},
        credits_per_execution = 0,
        max_inputs = 1,
        max_outputs = 1,
        is_active = true,
        display_order = 0
      } = nodeTypeData;

      const query = `
        INSERT INTO agent_node_types (
          type_key, name, category, icon, color, description,
          config_schema, credits_per_execution, max_inputs, max_outputs,
          is_active, display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        type_key,
        name,
        category,
        icon,
        color,
        description,
        JSON.stringify(config_schema),
        credits_per_execution,
        max_inputs,
        max_outputs,
        is_active,
        display_order
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建节点类型失败:', error);
      throw error;
    }
  }

  /**
   * 更新节点类型（管理员）
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'name', 'category', 'icon', 'color', 'description',
        'config_schema', 'credits_per_execution', 'max_inputs', 'max_outputs',
        'is_active', 'display_order'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);

          if (field === 'config_schema' && typeof updateData[field] === 'object') {
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
      const query = `UPDATE agent_node_types SET ${updates.join(', ')} WHERE id = ?`;

      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新节点类型失败:', error);
      throw error;
    }
  }

  /**
   * 删除节点类型（管理员）
   */
  static async delete(id) {
    try {
      const query = `DELETE FROM agent_node_types WHERE id = ?`;
      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除节点类型失败:', error);
      throw error;
    }
  }

  /**
   * 切换激活状态
   */
  static async toggleActive(id) {
    try {
      const query = `UPDATE agent_node_types SET is_active = NOT is_active WHERE id = ?`;
      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('切换节点类型状态失败:', error);
      throw error;
    }
  }
}

module.exports = AgentNodeType;
