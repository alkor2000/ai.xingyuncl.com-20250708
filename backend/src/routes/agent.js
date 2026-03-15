/**
 * Agent工作流路由（用户端）
 * 包含工作流管理、执行、测试对话、API Key管理
 */
const express = require('express');
const router = express.Router();
const AgentController = require('../controllers/AgentController');
const { authenticate } = require('../middleware/authMiddleware');

/* 所有路由需要登录 */
router.use(authenticate);

/* ========== 节点类型 ========== */
router.get('/node-types', AgentController.getNodeTypes);

/* ========== 知识库集成 ========== */
router.get('/wiki-items', AgentController.getWikiItems);

/* ========== 工作流管理 ========== */
router.get('/workflows', AgentController.getWorkflows);
router.get('/workflows/:id', AgentController.getWorkflowById);
router.post('/workflows', AgentController.createWorkflow);
router.put('/workflows/:id', AgentController.updateWorkflow);
router.delete('/workflows/:id', AgentController.deleteWorkflow);
router.post('/workflows/:id/toggle-publish', AgentController.togglePublish);

/* ========== 工作流执行 ========== */
router.post('/workflows/:id/execute', AgentController.executeWorkflow);

/* ========== 测试对话 ========== */
router.post('/workflows/:id/test/session', AgentController.createTestSession);
router.post('/workflows/:id/test/message', AgentController.sendTestMessage);
router.get('/workflows/:id/test/history', AgentController.getTestSessionHistory);
router.delete('/workflows/:id/test/session', AgentController.deleteTestSession);

/* ========== API Key 管理 ========== */
/* 获取工作流的API Key信息 */
router.get('/workflows/:id/api-key', AgentController.getApiKey);
/* 生成/重新生成API Key */
router.post('/workflows/:id/api-key', AgentController.createApiKey);
/* 更新API Key配置（访问控制） */
router.put('/workflows/:id/api-key', AgentController.updateApiKey);
/* 删除API Key */
router.delete('/workflows/:id/api-key', AgentController.deleteApiKey);
/* 获取API调用日志 */
router.get('/workflows/:id/api-key/logs', AgentController.getApiKeyLogs);

/* ========== 执行历史 ========== */
router.get('/executions', AgentController.getExecutions);
router.get('/executions/:id', AgentController.getExecutionById);
router.delete('/executions/:id', AgentController.deleteExecution);

/* ========== 统计信息 ========== */
router.get('/stats', AgentController.getUserStats);

module.exports = router;
