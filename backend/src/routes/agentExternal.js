/**
 * Agent外部API路由 v1.1
 * 
 * v1.1 - 新增流式输出端点 /run/stream 和 /chat/stream
 * 
 * 供外部系统通过API Key调用工作流
 * 路径前缀: /api/v1/agent
 * 认证方式: Authorization: Bearer ak-xxx
 * 
 * 端点：
 * - POST /api/v1/agent/run          一次性执行工作流（非流式）
 * - POST /api/v1/agent/run/stream   一次性执行工作流（流式SSE）
 * - POST /api/v1/agent/chat         多轮对话执行（非流式）
 * - POST /api/v1/agent/chat/stream  多轮对话执行（流式SSE）
 * - GET  /api/v1/agent/chat/:sid    获取对话历史
 * - DELETE /api/v1/agent/chat/:sid  结束对话会话
 */

const express = require('express');
const router = express.Router();
const AgentExternalController = require('../controllers/AgentExternalController');
const { agentApiAuth } = require('../middleware/agentApiAuth');

/* 所有外部API路由需要API Key认证 */
router.use(agentApiAuth);

/* 一次性执行工作流（非流式） */
router.post('/run', AgentExternalController.runWorkflow);

/* v1.1: 一次性执行工作流（流式SSE） */
router.post('/run/stream', AgentExternalController.runWorkflowStream);

/* 多轮对话（非流式） */
router.post('/chat', AgentExternalController.chatWorkflow);

/* v1.1: 多轮对话（流式SSE） */
router.post('/chat/stream', AgentExternalController.chatWorkflowStream);

/* 获取对话历史 */
router.get('/chat/:session_id', AgentExternalController.getChatHistory);

/* 结束对话会话 */
router.delete('/chat/:session_id', AgentExternalController.endChatSession);

module.exports = router;
