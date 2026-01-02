/**
 * Agent工作流控制器（用户端）
 * 处理工作流的CRUD和执行
 * v2.1 - 修复测试对话AI回复显示问题
 * v2.2 - 新增知识库集成getWikiItems方法
 */

const AgentWorkflow = require('../models/AgentWorkflow');
const AgentNodeType = require('../models/AgentNodeType');
const AgentExecution = require('../models/AgentExecution');
const WikiItem = require('../models/WikiItem');
const ExecutorService = require('../services/agent/ExecutorService');
const TestSessionService = require('../services/agent/TestSessionService');
const ResponseHelper = require('../utils/response');
const { calculateTokens, formatTokenCount } = require('../utils/tokenCalculator');
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
   * 获取用户可访问的知识库列表（v2.2新增）
   * 用于知识节点配置时选择知识库
   * 返回带有token数量的知识库列表
   */
  static async getWikiItems(req, res) {
    try {
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role;

      // 获取用户可访问的所有知识库
      const items = await WikiItem.getUserAccessibleItems(userId, groupId, userRole);

      // 为每个知识库计算token数量
      const itemsWithTokens = items.map(item => {
        const tokens = calculateTokens(item.content || '');
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          scope: item.scope,
          creator_name: item.creator_name,
          group_name: item.group_name,
          current_version: item.current_version,
          tokens: tokens,
          tokens_display: formatTokenCount(tokens),
          updated_at: item.updated_at
        };
      });

      logger.info('获取知识库列表成功', { 
        userId, 
        count: itemsWithTokens.length 
      });

      return ResponseHelper.success(res, itemsWithTokens, '获取知识库列表成功');
    } catch (error) {
      logger.error('获取知识库列表失败:', error);
      return ResponseHelper.error(res, '获取知识库列表失败');
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
   * 执行工作流（一次性执行，非对话模式）
   */
  static async executeWorkflow(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role;
      const { input_data = {} } = req.body;

      logger.info('开始执行工作流请求', { 
        workflowId: id, 
        userId, 
        inputData: input_data 
      });

      // 调用执行引擎，传入用户信息用于权限检查
      const result = await ExecutorService.executeWorkflow(
        parseInt(id), 
        userId, 
        input_data,
        { groupId, userRole }  // 传入用户上下文
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

  // ========== 测试对话接口 ==========

  /**
   * 创建测试会话
   */
  static async createTestSession(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // 验证工作流存在和权限
      const workflow = await AgentWorkflow.findById(id);

      if (!workflow) {
        return ResponseHelper.notFound(res, '工作流不存在');
      }

      if (workflow.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权访问此工作流');
      }

      // 创建测试会话
      const sessionId = TestSessionService.createSession(parseInt(id), userId);

      logger.info('创建测试会话成功', { sessionId, workflowId: id, userId });

      return ResponseHelper.success(res, { 
        session_id: sessionId,
        workflow_id: parseInt(id)
      }, '测试会话创建成功');

    } catch (error) {
      logger.error('创建测试会话失败:', error);
      return ResponseHelper.error(res, '创建测试会话失败');
    }
  }

  /**
   * 从工作流输出中提取纯文本内容
   * v2.1 新增：智能提取AI回复文本
   * @param {any} output - ExecutorService返回的output
   * @returns {string} 纯文本内容
   */
  static extractTextFromOutput(output) {
    if (!output) {
      return '无响应';
    }

    // 如果是字符串，直接返回
    if (typeof output === 'string') {
      return output;
    }

    // 如果是对象，按优先级尝试提取
    if (typeof output === 'object') {
      // 优先级1: result 字段（formatFinalOutput的输出格式）
      if (output.result !== undefined) {
        // result 可能还是对象
        if (typeof output.result === 'string') {
          return output.result;
        }
        if (typeof output.result === 'object' && output.result !== null) {
          // 递归提取
          return AgentController.extractTextFromOutput(output.result);
        }
        return String(output.result);
      }

      // 优先级2: content 字段（LLM节点原始输出格式）
      if (output.content !== undefined) {
        return String(output.content);
      }

      // 优先级3: output 字段
      if (output.output !== undefined) {
        return AgentController.extractTextFromOutput(output.output);
      }

      // 优先级4: text 字段
      if (output.text !== undefined) {
        return String(output.text);
      }

      // 优先级5: message 字段
      if (output.message !== undefined) {
        return String(output.message);
      }

      // 最后：如果只有 type 字段，说明是空响应
      if (Object.keys(output).length === 1 && output.type) {
        return '处理完成';
      }

      // 兜底：转为JSON（但这不应该发生了）
      logger.warn('无法提取文本内容，使用JSON序列化', { output });
      return JSON.stringify(output);
    }

    // 其他类型转字符串
    return String(output);
  }

  /**
   * 发送测试消息（对话式执行）
   * v2.1 修复：正确提取AI回复文本
   */
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

      // 验证会话
      const session = TestSessionService.getSession(session_id);
      if (!session) {
        return ResponseHelper.error(res, '会话不存在或已过期', 404);
      }

      if (session.userId !== userId) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      if (session.workflowId !== parseInt(id)) {
        return ResponseHelper.error(res, '会话与工作流不匹配', 400);
      }

      logger.info('发送测试消息', { 
        sessionId: session_id, 
        workflowId: id, 
        userId,
        message: message.substring(0, 50) + (message.length > 50 ? '...' : '')
      });

      // 添加用户消息到会话
      TestSessionService.addMessage(session_id, 'user', message);

      // 获取对话历史
      const messages = TestSessionService.getMessages(session_id);

      // 执行工作流，传入消息和历史
      const result = await ExecutorService.executeWorkflow(
        parseInt(id), 
        userId, 
        { 
          query: message,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content
          }))
        },
        { groupId, userRole }  // 传入用户上下文
      );

      // v2.1 修复：使用智能提取方法获取AI回复文本
      const aiReply = AgentController.extractTextFromOutput(result.output);

      logger.info('AI回复提取成功', {
        sessionId: session_id,
        outputType: typeof result.output,
        replyLength: aiReply.length,
        replyPreview: aiReply.substring(0, 100)
      });

      // 添加AI回复到会话
      TestSessionService.addMessage(session_id, 'assistant', aiReply);

      logger.info('测试消息执行成功', { 
        sessionId: session_id,
        workflowId: id, 
        userId, 
        creditsUsed: result.credits.used
      });

      return ResponseHelper.success(res, {
        message: {
          role: 'assistant',
          content: aiReply,
          timestamp: new Date()
        },
        execution_id: result.executionId,
        credits: result.credits,
        message_count: messages.length + 1
      }, '消息发送成功');

    } catch (error) {
      logger.error('发送测试消息失败:', { 
        workflowId: req.params.id, 
        userId: req.user.id, 
        error: error.message,
        stack: error.stack
      });

      // 根据错误类型返回不同的响应
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }

      return ResponseHelper.error(res, error.message || '消息发送失败');
    }
  }

  /**
   * 获取测试会话历史
   */
  static async getTestSessionHistory(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { session_id } = req.query;

      if (!session_id) {
        return ResponseHelper.validation(res, {
          session_id: '会话ID不能为空'
        });
      }

      // 验证会话
      const session = TestSessionService.getSession(session_id);
      if (!session) {
        return ResponseHelper.error(res, '会话不存在或已过期', 404);
      }

      if (session.userId !== userId) {
        return ResponseHelper.forbidden(res, '无权访问此会话');
      }

      const messages = TestSessionService.getMessages(session_id);

      return ResponseHelper.success(res, {
        session_id,
        workflow_id: parseInt(id),
        messages,
        message_count: messages.length
      }, '获取会话历史成功');

    } catch (error) {
      logger.error('获取测试会话历史失败:', error);
      return ResponseHelper.error(res, '获取会话历史失败');
    }
  }

  /**
   * 删除测试会话
   */
  static async deleteTestSession(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { session_id } = req.body;

      if (!session_id) {
        return ResponseHelper.validation(res, {
          session_id: '会话ID不能为空'
        });
      }

      // 验证会话
      const session = TestSessionService.getSession(session_id);
      if (!session) {
        return ResponseHelper.error(res, '会话不存在或已过期', 404);
      }

      if (session.userId !== userId) {
        return ResponseHelper.forbidden(res, '无权删除此会话');
      }

      TestSessionService.deleteSession(session_id);

      logger.info('删除测试会话成功', { sessionId: session_id, userId });

      return ResponseHelper.success(res, null, '会话已删除');

    } catch (error) {
      logger.error('删除测试会话失败:', error);
      return ResponseHelper.error(res, '删除会话失败');
    }
  }

  // ========== 执行历史相关 ==========

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
