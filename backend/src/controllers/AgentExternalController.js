/**
 * Agent外部API控制器 v1.1
 * 
 * v1.1 - 新增runWorkflowStream和chatWorkflowStream流式端点
 *   流式端点使用SSE（Server-Sent Events）实时推送AI输出
 *   SSE事件类型：init → progress → stream_start → message(delta) → done / error
 * 
 * 处理外部系统通过API Key发起的工作流调用
 * 支持一次性执行和多轮对话两种模式，各有流式/非流式版本
 */

const ExecutorService = require('../services/agent/ExecutorService');
const TestSessionService = require('../services/agent/TestSessionService');
const AgentApiKey = require('../models/AgentApiKey');
const AgentController = require('./AgentController');
const User = require('../models/User');
const logger = require('../utils/logger');

/* v1.1: 引入AICallHelper用于发送SSE事件 */
const AICallHelper = require('../services/agent/nodes/AICallHelper');

class AgentExternalController {
  /**
   * 一次性执行工作流（非流式）
   * POST /api/v1/agent/run
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

      const user = await User.findById(userId);
      if (!user) {
        return res.status(500).json({
          success: false,
          error: { code: 'OWNER_NOT_FOUND', message: '工作流创建者账号异常' }
        });
      }

      const inputData = { query, ...variables };
      const result = await ExecutorService.executeWorkflow(
        workflowId, userId, inputData,
        { groupId: user.group_id, userRole: user.role }
      );

      const duration = Date.now() - startTime;
      const outputText = AgentController.extractTextFromOutput(result.output);

      await AgentApiKey.updateCallStats(keyId, result.credits.used);
      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'run', caller_ip: callerIp,
        credits_used: result.credits.used, duration_ms: duration, status: 'success'
      });

      return res.json({
        success: true,
        data: {
          output: outputText, credits_used: result.credits.used,
          execution_id: result.executionId, duration_ms: duration
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'run', caller_ip: callerIp,
        duration_ms: duration, status: 'failed', error_message: error.message
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
   * v1.1: 一次性执行工作流（流式SSE）
   * POST /api/v1/agent/run/stream
   * 
   * SSE事件流：
   *   event: init      → { execution_id, workflow_name, node_count }
   *   event: progress   → { node_id, node_type, message }  （中间节点执行进度）
   *   event: stream_start → { node_id }  （最后LLM节点开始流式输出）
   *   event: message    → { delta, fullContent }  （AI输出增量）
   *   event: done       → { output, credits_used, execution_id, duration_ms }
   *   event: error      → { code, message }
   */
  static async runWorkflowStream(req, res) {
    const startTime = Date.now();
    const { keyId, workflowId, userId, callerIp } = req.agentApi;

    try {
      const { query = '', variables = {} } = req.body;

      if (!query && Object.keys(variables).length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_INPUT', message: '请提供query或variables参数' }
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(500).json({
          success: false,
          error: { code: 'OWNER_NOT_FOUND', message: '工作流创建者账号异常' }
        });
      }

      /* 设置SSE响应头 */
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });

      /* 流式执行工作流 */
      const inputData = { query, ...variables };
      const result = await ExecutorService.executeWorkflowStream(
        res, workflowId, userId, inputData,
        { groupId: user.group_id, userRole: user.role }
      );

      const duration = Date.now() - startTime;
      const outputText = AgentController.extractTextFromOutput(result.output);

      /* 更新调用统计 */
      await AgentApiKey.updateCallStats(keyId, result.credits.used);
      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'run_stream', caller_ip: callerIp,
        credits_used: result.credits.used, duration_ms: duration, status: 'success'
      });

      /* 发送done事件 */
      AICallHelper.sendSSE(res, 'done', {
        output: outputText,
        credits_used: result.credits.used,
        execution_id: result.executionId,
        duration_ms: duration
      });
      res.end();

    } catch (error) {
      const duration = Date.now() - startTime;

      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'run_stream', caller_ip: callerIp,
        duration_ms: duration, status: 'failed', error_message: error.message
      });

      logger.error('外部API流式执行失败:', { workflowId, keyId, error: error.message });

      /* 如果SSE头已发送，通过SSE事件返回错误 */
      if (res.headersSent) {
        AICallHelper.sendSSE(res, 'error', {
          code: error.message.includes('积分不足') ? 'INSUFFICIENT_CREDITS' : 'EXECUTION_ERROR',
          message: error.message
        });
        res.end();
      } else {
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
  }

  /**
   * 多轮对话（非流式）
   * POST /api/v1/agent/chat
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

      let sessionId = session_id;
      if (!sessionId) {
        sessionId = TestSessionService.createSession(workflowId, userId);
      } else {
        const session = TestSessionService.getSession(sessionId);
        if (!session) {
          sessionId = TestSessionService.createSession(workflowId, userId);
        }
      }

      TestSessionService.addMessage(sessionId, 'user', message);
      const messages = TestSessionService.getMessages(sessionId);

      const user = await User.findById(userId);

      const result = await ExecutorService.executeWorkflow(
        workflowId, userId,
        { query: message, messages: messages.map(m => ({ role: m.role, content: m.content })) },
        { groupId: user.group_id, userRole: user.role }
      );

      const duration = Date.now() - startTime;
      const reply = AgentController.extractTextFromOutput(result.output);

      TestSessionService.addMessage(sessionId, 'assistant', reply);

      await AgentApiKey.updateCallStats(keyId, result.credits.used);
      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'chat', session_id: sessionId, caller_ip: callerIp,
        credits_used: result.credits.used, duration_ms: duration, status: 'success'
      });

      const currentMessages = TestSessionService.getMessages(sessionId);

      return res.json({
        success: true,
        data: {
          session_id: sessionId, reply, credits_used: result.credits.used,
          message_count: currentMessages.length, duration_ms: duration
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'chat', caller_ip: callerIp,
        duration_ms: duration, status: 'failed', error_message: error.message
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
   * v1.1: 多轮对话（流式SSE）
   * POST /api/v1/agent/chat/stream
   * 
   * SSE事件流与run/stream一致，额外返回session_id
   */
  static async chatWorkflowStream(req, res) {
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

      let sessionId = session_id;
      if (!sessionId) {
        sessionId = TestSessionService.createSession(workflowId, userId);
      } else {
        const session = TestSessionService.getSession(sessionId);
        if (!session) {
          sessionId = TestSessionService.createSession(workflowId, userId);
        }
      }

      TestSessionService.addMessage(sessionId, 'user', message);
      const messages = TestSessionService.getMessages(sessionId);
      const user = await User.findById(userId);

      /* 设置SSE响应头 */
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });

      /* 流式执行工作流 */
      const result = await ExecutorService.executeWorkflowStream(
        res, workflowId, userId,
        { query: message, messages: messages.map(m => ({ role: m.role, content: m.content })) },
        { groupId: user.group_id, userRole: user.role }
      );

      const duration = Date.now() - startTime;
      const reply = AgentController.extractTextFromOutput(result.output);

      /* 保存AI回复到会话 */
      TestSessionService.addMessage(sessionId, 'assistant', reply);

      await AgentApiKey.updateCallStats(keyId, result.credits.used);
      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'chat_stream', session_id: sessionId, caller_ip: callerIp,
        credits_used: result.credits.used, duration_ms: duration, status: 'success'
      });

      const currentMessages = TestSessionService.getMessages(sessionId);

      /* 发送done事件 */
      AICallHelper.sendSSE(res, 'done', {
        session_id: sessionId,
        reply,
        credits_used: result.credits.used,
        message_count: currentMessages.length,
        duration_ms: duration
      });
      res.end();

    } catch (error) {
      const duration = Date.now() - startTime;

      await AgentApiKey.logCall({
        api_key_id: keyId, workflow_id: workflowId, user_id: userId,
        call_type: 'chat_stream', caller_ip: callerIp,
        duration_ms: duration, status: 'failed', error_message: error.message
      });

      logger.error('外部API流式对话失败:', { workflowId, keyId, error: error.message });

      if (res.headersSent) {
        AICallHelper.sendSSE(res, 'error', {
          code: error.message.includes('积分不足') ? 'INSUFFICIENT_CREDITS' : 'EXECUTION_ERROR',
          message: error.message
        });
        res.end();
      } else {
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
        data: { session_id, messages, message_count: messages.length }
      });
    } catch (error) {
      logger.error('获取对话历史失败:', error);
      return res.status(500).json({
        success: false, error: { code: 'ERROR', message: '获取对话历史失败' }
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
        success: true, data: { message: '会话已结束' }
      });
    } catch (error) {
      logger.error('结束对话会话失败:', error);
      return res.status(500).json({
        success: false, error: { code: 'ERROR', message: '结束会话失败' }
      });
    }
  }
}

module.exports = AgentExternalController;
