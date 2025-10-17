/**
 * Agent工作流控制器（用户端）
 * 处理工作流的CRUD和执行
 */

const AgentWorkflow = require('../models/AgentWorkflow');
const AgentNodeType = require('../models/AgentNodeType');
const AgentExecution = require('../models/AgentExecution');
const ExecutorService = require('../services/agent/ExecutorService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class AgentController {
  /**
   * 获取可用的节点类型列表
   */
  static async getNodeTypes(req, res) {
    try {
      const nodeTypes = await AgentNodeType.findAllActive();
      return ResponseHelper.success(res, nodeTypes, '获取节点类型成功');
    } catch (error) {
      logger.error('获取节点类型失败:', error);
      return ResponseHelper.error(res, '获取节点类型失败');
    }
  }

  /**
   * 获取用户的工作流列表
   */
  static async getWorkflows(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, is_published } = req.query;

      const result = await AgentWorkflow.findByUserId(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        is_published: is_published !== undefined ? is_published === 'true' : null
      });

      return ResponseHelper.success(res, result, '获取工作流列表成功');
    } catch (error) {
      logger.error('获取工作流列表失败:', error);
      return ResponseHelper.error(res, '获取工作流列表失败');
    }
  }

  /**
   * 获取单个工作流详情
   */
  static async getWorkflowById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const workflow = await AgentWorkflow.findById(id);

      if (!workflow) {
        return ResponseHelper.notFound(res, '工作流不存在');
      }

      // 验证权限
      if (workflow.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权访问此工作流');
      }

      return ResponseHelper.success(res, workflow, '获取工作流详情成功');
    } catch (error) {
      logger.error('获取工作流详情失败:', error);
      return ResponseHelper.error(res, '获取工作流详情失败');
    }
  }

  /**
   * 创建工作流
   */
  static async createWorkflow(req, res) {
    try {
      const userId = req.user.id;
      const { name, description, flow_data, is_published = false } = req.body;

      // 验证必填字段
      if (!name || !flow_data) {
        return ResponseHelper.validation(res, {
          name: !name ? '工作流名称不能为空' : null,
          flow_data: !flow_data ? '工作流数据不能为空' : null
        });
      }

      // 验证flow_data结构
      if (!flow_data.nodes || !flow_data.edges) {
        return ResponseHelper.validation(res, {
          flow_data: '工作流数据格式不正确，需要包含nodes和edges'
        });
      }

      const workflowId = await AgentWorkflow.create({
        user_id: userId,
        name,
        description,
        flow_data,
        is_published
      });

      logger.info('创建工作流成功', { userId, workflowId, name });

      return ResponseHelper.success(res, { id: workflowId }, '工作流创建成功', 201);
    } catch (error) {
      logger.error('创建工作流失败:', error);
      return ResponseHelper.error(res, error.message || '创建工作流失败');
    }
  }

  /**
   * 更新工作流
   */
  static async updateWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { name, description, flow_data, is_published } = req.body;

      // 验证工作流存在和权限
      const workflow = await AgentWorkflow.findById(id);

      if (!workflow) {
        return ResponseHelper.notFound(res, '工作流不存在');
      }

      if (workflow.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权修改此工作流');
      }

      // 如果更新flow_data，验证结构
      if (flow_data && (!flow_data.nodes || !flow_data.edges)) {
        return ResponseHelper.validation(res, {
          flow_data: '工作流数据格式不正确，需要包含nodes和edges'
        });
      }

      const updated = await AgentWorkflow.update(id, {
        name,
        description,
        flow_data,
        is_published
      });

      if (!updated) {
        return ResponseHelper.error(res, '更新工作流失败');
      }

      logger.info('更新工作流成功', { userId, workflowId: id });

      return ResponseHelper.success(res, { id }, '工作流更新成功');
    } catch (error) {
      logger.error('更新工作流失败:', error);
      return ResponseHelper.error(res, error.message || '更新工作流失败');
    }
  }

  /**
   * 删除工作流
   */
  static async deleteWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const deleted = await AgentWorkflow.delete(id, userId);

      if (!deleted) {
        return ResponseHelper.notFound(res, '工作流不存在或无权删除');
      }

      logger.info('删除工作流成功', { userId, workflowId: id });

      return ResponseHelper.success(res, null, '工作流删除成功');
    } catch (error) {
      logger.error('删除工作流失败:', error);
      return ResponseHelper.error(res, '删除工作流失败');
    }
  }

  /**
   * 切换工作流发布状态
   */
  static async togglePublish(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const toggled = await AgentWorkflow.togglePublish(id, userId);

      if (!toggled) {
        return ResponseHelper.notFound(res, '工作流不存在或无权修改');
      }

      logger.info('切换工作流发布状态成功', { userId, workflowId: id });

      return ResponseHelper.success(res, null, '发布状态更新成功');
    } catch (error) {
      logger.error('切换发布状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }

  /**
   * 执行工作流（已实现）
   */
  static async executeWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { input_data = {} } = req.body;

      logger.info('开始执行工作流请求', { 
        workflowId: id, 
        userId, 
        inputData: input_data 
      });

      // 调用执行引擎
      const result = await ExecutorService.executeWorkflow(
        parseInt(id), 
        userId, 
        input_data
      );

      logger.info('工作流执行成功', { 
        workflowId: id, 
        userId, 
        executionId: result.executionId,
        creditsUsed: result.credits.used
      });

      return ResponseHelper.success(res, result, '工作流执行成功');

    } catch (error) {
      logger.error('执行工作流失败:', { 
        workflowId: req.params.id, 
        userId: req.user.id, 
        error: error.message,
        stack: error.stack
      });

      // 根据错误类型返回不同的响应
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }

      if (error.message.includes('不存在') || error.message.includes('未找到')) {
        return ResponseHelper.notFound(res, error.message);
      }

      if (error.message.includes('无权')) {
        return ResponseHelper.forbidden(res, error.message);
      }

      if (error.message.includes('未发布')) {
        return ResponseHelper.validation(res, null, error.message);
      }

      return ResponseHelper.error(res, error.message || '执行工作流失败');
    }
  }

  /**
   * 获取执行历史
   */
  static async getExecutions(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, workflow_id, status } = req.query;

      const result = await AgentExecution.findByUserId(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        workflow_id: workflow_id ? parseInt(workflow_id) : null,
        status
      });

      return ResponseHelper.success(res, result, '获取执行历史成功');
    } catch (error) {
      logger.error('获取执行历史失败:', error);
      return ResponseHelper.error(res, '获取执行历史失败');
    }
  }

  /**
   * 获取单个执行记录详情
   */
  static async getExecutionById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const execution = await AgentExecution.findById(id);

      if (!execution) {
        return ResponseHelper.notFound(res, '执行记录不存在');
      }

      // 验证权限
      if (execution.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权查看此执行记录');
      }

      return ResponseHelper.success(res, execution, '获取执行详情成功');
    } catch (error) {
      logger.error('获取执行详情失败:', error);
      return ResponseHelper.error(res, '获取执行详情失败');
    }
  }

  /**
   * 删除执行记录
   */
  static async deleteExecution(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const deleted = await AgentExecution.delete(id, userId);

      if (!deleted) {
        return ResponseHelper.notFound(res, '执行记录不存在或无权删除');
      }

      logger.info('删除执行记录成功', { userId, executionId: id });

      return ResponseHelper.success(res, null, '执行记录删除成功');
    } catch (error) {
      logger.error('删除执行记录失败:', error);
      return ResponseHelper.error(res, '删除执行记录失败');
    }
  }

  /**
   * 获取用户统计信息
   */
  static async getUserStats(req, res) {
    try {
      const userId = req.user.id;

      const workflowStats = await AgentWorkflow.getUserStats(userId);
      const executionStats = await AgentExecution.getUserStats(userId);

      const stats = {
        workflows: workflowStats,
        executions: executionStats
      };

      return ResponseHelper.success(res, stats, '获取统计信息成功');
    } catch (error) {
      logger.error('获取统计信息失败:', error);
      return ResponseHelper.error(res, '获取统计信息失败');
    }
  }
}

module.exports = AgentController;
