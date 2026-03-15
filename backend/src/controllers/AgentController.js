/**
 * Agent工作流控制器（用户端）
 * 处理工作流的CRUD、执行、测试对话、API Key管理
 */

const AgentWorkflow = require('../models/AgentWorkflow');
const AgentNodeType = require('../models/AgentNodeType');
const AgentExecution = require('../models/AgentExecution');
const AgentApiKey = require('../models/AgentApiKey');
const WikiItem = require('../models/WikiItem');
const ExecutorService = require('../services/agent/ExecutorService');
const TestSessionService = require('../services/agent/TestSessionService');
const ResponseHelper = require('../utils/response');
const { calculateTokens, formatTokenCount } = require('../utils/tokenCalculator');
const logger = require('../utils/logger');

class AgentController {
  /* ========== 节点类型 ========== */

  /** 获取可用的节点类型列表 */
  static async getNodeTypes(req, res) {
    try {
      const nodeTypes = await AgentNodeType.findAllActive();
      return ResponseHelper.success(res, nodeTypes, '获取节点类型成功');
    } catch (error) {
      logger.error('获取节点类型失败:', error);
      return ResponseHelper.error(res, '获取节点类型失败');
    }
  }

  /** 获取用户可访问的知识库列表 */
  static async getWikiItems(req, res) {
    try {
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role;

      const items = await WikiItem.getUserAccessibleItems(userId, groupId, userRole);

      const itemsWithTokens = items.map(item => {
        const tokens = calculateTokens(item.content || '');
        return {
          id: item.id, title: item.title, description: item.description,
          scope: item.scope, creator_name: item.creator_name,
          group_name: item.group_name, current_version: item.current_version,
          tokens, tokens_display: formatTokenCount(tokens),
          updated_at: item.updated_at
        };
      });

      return ResponseHelper.success(res, itemsWithTokens, '获取知识库列表成功');
    } catch (error) {
      logger.error('获取知识库列表失败:', error);
      return ResponseHelper.error(res, '获取知识库列表失败');
    }
  }

  /* ========== 工作流管理 ========== */

  /** 获取用户的工作流列表 */
  static async getWorkflows(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, is_published } = req.query;
      const result = await AgentWorkflow.findByUserId(userId, {
        page: parseInt(page), limit: parseInt(limit),
        is_published: is_published !== undefined ? is_published === 'true' : null
      });
      return ResponseHelper.success(res, result, '获取工作流列表成功');
    } catch (error) {
      logger.error('获取工作流列表失败:', error);
      return ResponseHelper.error(res, '获取工作流列表失败');
    }
  }

  /** 获取单个工作流详情 */
  static async getWorkflowById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权访问此工作流');
      return ResponseHelper.success(res, workflow, '获取工作流详情成功');
    } catch (error) {
      logger.error('获取工作流详情失败:', error);
      return ResponseHelper.error(res, '获取工作流详情失败');
    }
  }

  /** 创建工作流 */
  static async createWorkflow(req, res) {
    try {
      const userId = req.user.id;
      const { name, description, flow_data, is_published = false } = req.body;

      if (!name || !flow_data) {
        return ResponseHelper.validation(res, {
          name: !name ? '工作流名称不能为空' : null,
          flow_data: !flow_data ? '工作流数据不能为空' : null
        });
      }
      if (!flow_data.nodes || !flow_data.edges) {
        return ResponseHelper.validation(res, { flow_data: '工作流数据格式不正确' });
      }

      const workflowId = await AgentWorkflow.create({
        user_id: userId, name, description, flow_data, is_published
      });

      logger.info('创建工作流成功', { userId, workflowId, name });
      return ResponseHelper.success(res, { id: workflowId }, '工作流创建成功', 201);
    } catch (error) {
      logger.error('创建工作流失败:', error);
      return ResponseHelper.error(res, error.message || '创建工作流失败');
    }
  }

  /** 更新工作流 */
  static async updateWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { name, description, flow_data, is_published } = req.body;

      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权修改此工作流');
      if (flow_data && (!flow_data.nodes || !flow_data.edges)) {
        return ResponseHelper.validation(res, { flow_data: '工作流数据格式不正确' });
      }

      const updated = await AgentWorkflow.update(id, { name, description, flow_data, is_published });
      if (!updated) return ResponseHelper.error(res, '更新工作流失败');
      return ResponseHelper.success(res, { id }, '工作流更新成功');
    } catch (error) {
      logger.error('更新工作流失败:', error);
      return ResponseHelper.error(res, error.message || '更新工作流失败');
    }
  }

  /** 删除工作流 */
  static async deleteWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      /* 删除工作流时同时清理关联的API Key */
      await AgentApiKey.deleteByWorkflowId(parseInt(id), userId).catch(() => {});

      const deleted = await AgentWorkflow.delete(id, userId);
      if (!deleted) return ResponseHelper.notFound(res, '工作流不存在或无权删除');
      return ResponseHelper.success(res, null, '工作流删除成功');
    } catch (error) {
      logger.error('删除工作流失败:', error);
      return ResponseHelper.error(res, '删除工作流失败');
    }
  }

  /** 切换工作流发布状态 */
  static async togglePublish(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权修改');

      const toggled = await AgentWorkflow.togglePublish(id, userId);
      if (!toggled) return ResponseHelper.notFound(res, '操作失败');

      /* 发布时自动创建API Key（如果不存在） */
      if (!workflow.is_published) {
        const existingKey = await AgentApiKey.findByWorkflowId(parseInt(id));
        if (!existingKey) {
          try {
            await AgentApiKey.create({
              workflow_id: parseInt(id),
              user_id: userId,
              key_name: `${workflow.name} - API Key`
            });
            logger.info('发布时自动创建API Key', { workflowId: id });
          } catch (keyError) {
            logger.warn('自动创建API Key失败（非致命）:', keyError.message);
          }
        }
      }

      return ResponseHelper.success(res, null, '发布状态更新成功');
    } catch (error) {
      logger.error('切换发布状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }

  /* ========== 工作流执行 ========== */

  /** 执行工作流（一次性） */
  static async executeWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role;
      const { input_data = {} } = req.body;

      const result = await ExecutorService.executeWorkflow(
        parseInt(id), userId, input_data,
        { groupId, userRole }
      );

      return ResponseHelper.success(res, result, '工作流执行成功');
    } catch (error) {
      logger.error('执行工作流失败:', { workflowId: req.params.id, error: error.message });
      if (error.message.includes('积分不足')) return ResponseHelper.error(res, error.message, 402);
      if (error.message.includes('不存在')) return ResponseHelper.notFound(res, error.message);
      if (error.message.includes('无权')) return ResponseHelper.forbidden(res, error.message);
      return ResponseHelper.error(res, error.message || '执行工作流失败');
    }
  }

  /* ========== 测试对话 ========== */

  /** 创建测试会话 */
  static async createTestSession(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权访问');

      const sessionId = TestSessionService.createSession(parseInt(id), userId);
      return ResponseHelper.success(res, {
        session_id: sessionId, workflow_id: parseInt(id)
      }, '测试会话创建成功');
    } catch (error) {
      logger.error('创建测试会话失败:', error);
      return ResponseHelper.error(res, '创建测试会话失败');
    }
  }

  /**
   * 从工作流输出中提取纯文本内容
   * @param {any} output - ExecutorService返回的output
   * @returns {string} 纯文本内容
   */
  static extractTextFromOutput(output) {
    if (!output) return '无响应';
    if (typeof output === 'string') return output;

    if (typeof output === 'object') {
      if (output.result !== undefined) {
        if (typeof output.result === 'string') return output.result;
        if (typeof output.result === 'object' && output.result !== null) {
          return AgentController.extractTextFromOutput(output.result);
        }
        return String(output.result);
      }
      if (output.content !== undefined) return String(output.content);
      if (output.output !== undefined) return AgentController.extractTextFromOutput(output.output);
      if (output.text !== undefined) return String(output.text);
      if (output.message !== undefined) return String(output.message);
      if (Object.keys(output).length === 1 && output.type) return '处理完成';

      logger.warn('无法提取文本内容，使用JSON序列化', { output });
      return JSON.stringify(output);
    }

    return String(output);
  }

  /** 发送测试消息 */
  static async sendTestMessage(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role;
      const { session_id, message } = req.body;

      if (!session_id || !message) {
        return ResponseHelper.validation(res, {
          session_id: !session_id ? '会话ID不能为空' : null,
          message: !message ? '消息不能为空' : null
        });
      }

      const session = TestSessionService.getSession(session_id);
      if (!session) return ResponseHelper.error(res, '会话不存在或已过期', 404);
      if (session.userId !== userId) return ResponseHelper.forbidden(res, '无权访问');
      if (session.workflowId !== parseInt(id)) return ResponseHelper.error(res, '会话与工作流不匹配', 400);

      TestSessionService.addMessage(session_id, 'user', message);
      const messages = TestSessionService.getMessages(session_id);

      const result = await ExecutorService.executeWorkflow(
        parseInt(id), userId,
        { query: message, messages: messages.map(m => ({ role: m.role, content: m.content })) },
        { groupId, userRole }
      );

      const aiReply = AgentController.extractTextFromOutput(result.output);
      TestSessionService.addMessage(session_id, 'assistant', aiReply);

      return ResponseHelper.success(res, {
        message: { role: 'assistant', content: aiReply, timestamp: new Date() },
        execution_id: result.executionId,
        credits: result.credits,
        message_count: messages.length + 1
      }, '消息发送成功');
    } catch (error) {
      logger.error('发送测试消息失败:', { workflowId: req.params.id, error: error.message });
      if (error.message.includes('积分不足')) return ResponseHelper.error(res, error.message, 402);
      return ResponseHelper.error(res, error.message || '消息发送失败');
    }
  }

  /** 获取测试会话历史 */
  static async getTestSessionHistory(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { session_id } = req.query;
      if (!session_id) return ResponseHelper.validation(res, { session_id: '会话ID不能为空' });

      const session = TestSessionService.getSession(session_id);
      if (!session) return ResponseHelper.error(res, '会话不存在或已过期', 404);
      if (session.userId !== userId) return ResponseHelper.forbidden(res, '无权访问');

      const messages = TestSessionService.getMessages(session_id);
      return ResponseHelper.success(res, {
        session_id, workflow_id: parseInt(id), messages, message_count: messages.length
      }, '获取会话历史成功');
    } catch (error) {
      logger.error('获取测试会话历史失败:', error);
      return ResponseHelper.error(res, '获取会话历史失败');
    }
  }

  /** 删除测试会话 */
  static async deleteTestSession(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { session_id } = req.body;
      if (!session_id) return ResponseHelper.validation(res, { session_id: '会话ID不能为空' });

      const session = TestSessionService.getSession(session_id);
      if (!session) return ResponseHelper.error(res, '会话不存在或已过期', 404);
      if (session.userId !== userId) return ResponseHelper.forbidden(res, '无权删除');

      TestSessionService.deleteSession(session_id);
      return ResponseHelper.success(res, null, '会话已删除');
    } catch (error) {
      logger.error('删除测试会话失败:', error);
      return ResponseHelper.error(res, '删除会话失败');
    }
  }

  /* ========== API Key 管理 ========== */

  /** 获取工作流的API Key信息 */
  static async getApiKey(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权访问');

      const apiKey = await AgentApiKey.findByWorkflowId(parseInt(id));
      if (!apiKey) {
        return ResponseHelper.success(res, null, '暂无API Key');
      }

      return ResponseHelper.success(res, apiKey.toSafeJSON(), '获取API Key成功');
    } catch (error) {
      logger.error('获取API Key失败:', error);
      return ResponseHelper.error(res, '获取API Key失败');
    }
  }

  /** 创建或重新生成API Key */
  static async createApiKey(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { regenerate = false } = req.body;

      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权操作');

      let result;
      if (regenerate) {
        result = await AgentApiKey.regenerate(parseInt(id), userId);
      } else {
        const existing = await AgentApiKey.findByWorkflowId(parseInt(id));
        if (existing) {
          /* 已存在则重新生成 */
          result = await AgentApiKey.regenerate(parseInt(id), userId);
        } else {
          result = await AgentApiKey.create({
            workflow_id: parseInt(id),
            user_id: userId,
            key_name: `${workflow.name} - API Key`
          });
        }
      }

      /* 返回明文密钥（仅此一次） */
      return ResponseHelper.success(res, {
        id: result.id,
        api_key: result.api_key,
        message: '请妥善保管API Key，此密钥仅显示一次'
      }, 'API Key生成成功');
    } catch (error) {
      logger.error('创建API Key失败:', error);
      return ResponseHelper.error(res, error.message || '创建API Key失败');
    }
  }

  /** 更新API Key配置 */
  static async updateApiKey(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const config = req.body;

      await AgentApiKey.updateConfig(parseInt(id), userId, config);
      return ResponseHelper.success(res, null, 'API Key配置更新成功');
    } catch (error) {
      logger.error('更新API Key配置失败:', error);
      return ResponseHelper.error(res, error.message || '更新配置失败');
    }
  }

  /** 删除API Key */
  static async deleteApiKey(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const deleted = await AgentApiKey.deleteByWorkflowId(parseInt(id), userId);
      if (!deleted) return ResponseHelper.notFound(res, 'API Key不存在');
      return ResponseHelper.success(res, null, 'API Key已删除');
    } catch (error) {
      logger.error('删除API Key失败:', error);
      return ResponseHelper.error(res, '删除API Key失败');
    }
  }

  /** 获取API调用日志 */
  static async getApiKeyLogs(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const workflow = await AgentWorkflow.findById(id);
      if (!workflow) return ResponseHelper.notFound(res, '工作流不存在');
      if (workflow.user_id !== userId) return ResponseHelper.forbidden(res, '无权访问');

      const result = await AgentApiKey.getCallLogs(parseInt(id), {
        page: parseInt(page), limit: parseInt(limit)
      });

      return ResponseHelper.success(res, result, '获取调用日志成功');
    } catch (error) {
      logger.error('获取API调用日志失败:', error);
      return ResponseHelper.error(res, '获取调用日志失败');
    }
  }

  /* ========== 执行历史 ========== */

  /** 获取执行历史 */
  static async getExecutions(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, workflow_id, status } = req.query;
      const result = await AgentExecution.findByUserId(userId, {
        page: parseInt(page), limit: parseInt(limit),
        workflow_id: workflow_id ? parseInt(workflow_id) : null, status
      });
      return ResponseHelper.success(res, result, '获取执行历史成功');
    } catch (error) {
      logger.error('获取执行历史失败:', error);
      return ResponseHelper.error(res, '获取执行历史失败');
    }
  }

  /** 获取单个执行记录详情 */
  static async getExecutionById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const execution = await AgentExecution.findById(id);
      if (!execution) return ResponseHelper.notFound(res, '执行记录不存在');
      if (execution.user_id !== userId) return ResponseHelper.forbidden(res, '无权查看');
      return ResponseHelper.success(res, execution, '获取执行详情成功');
    } catch (error) {
      logger.error('获取执行详情失败:', error);
      return ResponseHelper.error(res, '获取执行详情失败');
    }
  }

  /** 删除执行记录 */
  static async deleteExecution(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const deleted = await AgentExecution.delete(id, userId);
      if (!deleted) return ResponseHelper.notFound(res, '执行记录不存在或无权删除');
      return ResponseHelper.success(res, null, '执行记录删除成功');
    } catch (error) {
      logger.error('删除执行记录失败:', error);
      return ResponseHelper.error(res, '删除执行记录失败');
    }
  }

  /** 获取用户统计信息 */
  static async getUserStats(req, res) {
    try {
      const userId = req.user.id;
      const workflowStats = await AgentWorkflow.getUserStats(userId);
      const executionStats = await AgentExecution.getUserStats(userId);
      return ResponseHelper.success(res, {
        workflows: workflowStats, executions: executionStats
      }, '获取统计信息成功');
    } catch (error) {
      logger.error('获取统计信息失败:', error);
      return ResponseHelper.error(res, '获取统计信息失败');
    }
  }
}

module.exports = AgentController;
