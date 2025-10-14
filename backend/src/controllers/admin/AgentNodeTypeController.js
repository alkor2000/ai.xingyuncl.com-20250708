/**
 * Agent节点类型控制器（管理员）
 * 管理节点类型的配置
 */

const AgentNodeType = require('../../models/AgentNodeType');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class AgentNodeTypeController {
  /**
   * 获取所有节点类型（包括未激活的）
   */
  static async getAllNodeTypes(req, res) {
    try {
      const nodeTypes = await AgentNodeType.findAll();
      return ResponseHelper.success(res, nodeTypes, '获取节点类型列表成功');
    } catch (error) {
      logger.error('获取节点类型列表失败:', error);
      return ResponseHelper.error(res, '获取节点类型列表失败');
    }
  }

  /**
   * 创建节点类型
   */
  static async createNodeType(req, res) {
    try {
      const {
        type_key,
        name,
        category,
        icon,
        color,
        description,
        config_schema,
        credits_per_execution,
        max_inputs,
        max_outputs,
        is_active,
        display_order
      } = req.body;

      // 验证必填字段
      if (!type_key || !name) {
        return ResponseHelper.validation(res, {
          type_key: !type_key ? '节点类型标识不能为空' : null,
          name: !name ? '节点名称不能为空' : null
        });
      }

      // 验证type_key唯一性
      const existing = await AgentNodeType.findByTypeKey(type_key);
      if (existing) {
        return ResponseHelper.validation(res, {
          type_key: '节点类型标识已存在'
        });
      }

      const nodeTypeId = await AgentNodeType.create({
        type_key,
        name,
        category,
        icon,
        color,
        description,
        config_schema,
        credits_per_execution,
        max_inputs,
        max_outputs,
        is_active,
        display_order
      });

      logger.info('创建节点类型成功', { nodeTypeId, type_key, name });

      return ResponseHelper.success(res, { id: nodeTypeId }, '节点类型创建成功', 201);
    } catch (error) {
      logger.error('创建节点类型失败:', error);
      return ResponseHelper.error(res, error.message || '创建节点类型失败');
    }
  }

  /**
   * 更新节点类型
   */
  static async updateNodeType(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // 如果更新type_key，验证唯一性
      if (updateData.type_key) {
        const existing = await AgentNodeType.findByTypeKey(updateData.type_key);
        if (existing && existing.id !== parseInt(id)) {
          return ResponseHelper.validation(res, {
            type_key: '节点类型标识已存在'
          });
        }
      }

      const updated = await AgentNodeType.update(id, updateData);

      if (!updated) {
        return ResponseHelper.notFound(res, '节点类型不存在');
      }

      logger.info('更新节点类型成功', { nodeTypeId: id });

      return ResponseHelper.success(res, { id }, '节点类型更新成功');
    } catch (error) {
      logger.error('更新节点类型失败:', error);
      return ResponseHelper.error(res, error.message || '更新节点类型失败');
    }
  }

  /**
   * 删除节点类型
   */
  static async deleteNodeType(req, res) {
    try {
      const { id } = req.params;

      const deleted = await AgentNodeType.delete(id);

      if (!deleted) {
        return ResponseHelper.notFound(res, '节点类型不存在');
      }

      logger.info('删除节点类型成功', { nodeTypeId: id });

      return ResponseHelper.success(res, null, '节点类型删除成功');
    } catch (error) {
      logger.error('删除节点类型失败:', error);
      return ResponseHelper.error(res, '删除节点类型失败');
    }
  }

  /**
   * 切换节点类型激活状态
   */
  static async toggleActive(req, res) {
    try {
      const { id } = req.params;

      const toggled = await AgentNodeType.toggleActive(id);

      if (!toggled) {
        return ResponseHelper.notFound(res, '节点类型不存在');
      }

      logger.info('切换节点类型状态成功', { nodeTypeId: id });

      return ResponseHelper.success(res, null, '节点类型状态更新成功');
    } catch (error) {
      logger.error('切换节点类型状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }
}

module.exports = AgentNodeTypeController;
