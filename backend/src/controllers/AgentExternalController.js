/**
 * Agent外部API控制器
 * 
 * 处理外部系统通过API Key发起的工作流调用
 * 支持一次性执行和多轮对话两种模式
 * 
 * 所有请求已经过agentApiAuth中间件认证
 * req.agentApi 包含: keyId, keyRecord, workflowId, userId, callerIp
 */

const ExecutorService = require('../services/agent/ExecutorService');
const TestSessionService = require('../services/agent/TestSessionService');
const AgentApiKey = require('../models/AgentApiKey');
const AgentController = require('./AgentController');
const User = require('../models/User');
const logger = require('../utils/logger');

class AgentExternalController {
  /**
   * 一次性执行工作流
   * POST /api/v1/agent/run
   * 
   * 请求体:
   * {
   *   "query": "用户输入的问题",
   *   "variables": { ... }  // 可选，额外变量
   * }
   * 
   * 响应:
   * {
   *   "success": true,
   *   "data": {
   *     "output": "AI回复内容",
   *     "credits_used": 10,
   *     "execution_id": 123,
   *     "duration_ms": 2500
   *   }
   * }
   */
  static async runWorkflow(req, res) {
    const startTime = Date.now();
    const { keyId, workflowId, userId, callerIp, keyRecord } = req.agentApi;

    try {
      const { query = '', variables = {} } = req.body;

      if (!query && Object.keys(variables).length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_INPUT', message: '请提供query或variables参数' }
        });
      }

      /* 检查创建者积分 */
      const user = await User.findById(userId);
      if (!user) {
        return res.status(500).json({
          success: false,
          error: { code: 'OWNER_NOT_FOUND', message: '工作流创建者账号异常' }
        });
      }

      /* 执行工作流 */
      const inputData = { query, ...variables };
      const result = await ExecutorService.executeWorkflow(
        workflowId, userId, inputData,
        { groupId: user.group_id, userRole: user.role }
      );

      const duration = Date.now() - startTime;

      /* 提取文本输出 */
      const outputText = AgentController.extractTextFromOutput(result.output);

      /* 更新调用统计 */
      await AgentApiKey.updateCallStats(keyId, result.credits.used);

      /* 记录调用日志 */
      await AgentApiKey.logCall({
        api_key_id: keyId,
        workflow_id: workflowId,
        user_id: userId,
        call_type: 'run',
        caller_ip: callerIp,
        credits_used: result.credits.used,
        duration_ms: duration,
        status: 'success'
      });

      logger.info('外部API执行成功', {
        workflowId, keyId, duration, creditsUsed: result.credits.used
      });

      return res.json({
        success: true,
        data: {
          output: outputText,
          credits_used: result.credits.used,
          execution_id: result.executionId,
          duration_ms: duration
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      /* 记录失败日志 */
      await AgentApiKey.logCall({
        api_key_id: keyId,
        workflow_id: workflowId,
        user_id: userId,
        call_type: 'run',
        caller_ip: callerIp,
        duration_ms: duration,
        status: 'failed',
        error_message: error.message
      });

      logger.error('外部API执行失败:', { workflowId, keyId, error: error.message });

      const statusCode = error.message.includes('积分不足') ? 402 : 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 402 ? 'INSUFFICIENT_CREDITS' : 'EXECUTION_ERROR',
          message: error.message
        }
      });
    }
  }

  /**
   * 多轮对话
   * POST /api/v1/agent/chat
   * 
   * 请求体:
   * {
   *   "session_id": "可选，不传则自动创建新会话",
   *   "message": "用户消息"
   * }
   * 
   * 响应:
   * {
   *   "success": true,
   *   "data": {
   *     "session_id": "会话ID",
   *     "reply": "AI回复",
   *     "credits_used": 10,
   *     "message_count": 3
   *   }
   * }
   */
  static async chatWorkflow(req, res) {
    const startTime = Date.now();
    const { keyId, workflowId, userId, callerIp } = req.agentApi;

    try {
      const { session_id, message } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_MESSAGE', message: '请提供message参数' }
        });
      }

      /* 获取或创建会话 */
      let sessionId = session_id;
      if (!sessionId) {
        sessionId = TestSessionService.createSession(workflowId, userId);
      } else {
        /* 验证会话存在 */
        const session = TestSessionService.getSession(sessionId);
        if (!session) {
          /* 会话不存在或过期，自动创建新会话 */
          sessionId = TestSessionService.createSession(workflowId, userId);
        }
      }

      /* 添加用户消息 */
      TestSessionService.addMessage(sessionId, 'user', message);

      /* 获取对话历史 */
      const messages = TestSessionService.getMessages(sessionId);

      /* 检查创建者积分 */
      const user = await User.findById(userId);

      /* 执行工作流 */
      const result = await ExecutorService.executeWorkflow(
        workflowId, userId,
        {
          query: message,
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        },
        { groupId: user.group_id, userRole: user.role }
      );

      const duration = Date.now() - startTime;

      /* 提取回复文本 */
      const reply = AgentController.extractTextFromOutput(result.output);

      /* 添加AI回复到会话 */
      TestSessionService.addMessage(sessionId, 'assistant', reply);

      /* 更新统计 */
      await AgentApiKey.updateCallStats(keyId, result.credits.used);

      /* 记录日志 */
      await AgentApiKey.logCall({
        api_key_id: keyId,
        workflow_id: workflowId,
        user_id: userId,
        call_type: 'chat',
        session_id: sessionId,
        caller_ip: callerIp,
        credits_used: result.credits.used,
        duration_ms: duration,
        status: 'success'
      });

      const currentMessages = TestSessionService.getMessages(sessionId);

      return res.json({
        success: true,
        data: {
          session_id: sessionId,
          reply: reply,
          credits_used: result.credits.used,
          message_count: currentMessages.length,
          duration_ms: duration
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      await AgentApiKey.logCall({
        api_key_id: keyId,
        workflow_id: workflowId,
        user_id: userId,
        call_type: 'chat',
        caller_ip: callerIp,
        duration_ms: duration,
        status: 'failed',
        error_message: error.message
      });

      logger.error('外部API对话失败:', { workflowId, keyId, error: error.message });

      const statusCode = error.message.includes('积分不足') ? 402 : 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 402 ? 'INSUFFICIENT_CREDITS' : 'EXECUTION_ERROR',
          message: error.message
        }
      });
    }
  }

  /**
   * 获取对话历史
   * GET /api/v1/agent/chat/:session_id
   */
  static async getChatHistory(req, res) {
    try {
      const { session_id } = req.params;
      const { userId } = req.agentApi;

      const session = TestSessionService.getSession(session_id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: '会话不存在或已过期' }
        });
      }

      if (session.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'ACCESS_DENIED', message: '无权访问此会话' }
        });
      }

      const messages = TestSessionService.getMessages(session_id);

      return res.json({
        success: true,
        data: {
          session_id: session_id,
          messages: messages,
          message_count: messages.length
        }
      });
    } catch (error) {
      logger.error('获取对话历史失败:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'ERROR', message: '获取对话历史失败' }
      });
    }
  }

  /**
   * 结束对话会话
   * DELETE /api/v1/agent/chat/:session_id
   */
  static async endChatSession(req, res) {
    try {
      const { session_id } = req.params;
      const { userId } = req.agentApi;

      const session = TestSessionService.getSession(session_id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: '会话不存在或已过期' }
        });
      }

      if (session.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'ACCESS_DENIED', message: '无权操作此会话' }
        });
      }

      TestSessionService.deleteSession(session_id);

      return res.json({
        success: true,
        data: { message: '会话已结束' }
      });
    } catch (error) {
      logger.error('结束对话会话失败:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'ERROR', message: '结束会话失败' }
      });
    }
  }
}

module.exports = AgentExternalController;
