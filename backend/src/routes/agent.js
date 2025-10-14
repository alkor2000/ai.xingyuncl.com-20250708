/**
 * Agent工作流路由（用户端）
 */

const express = require('express');
const router = express.Router();
const AgentController = require('../controllers/AgentController');
const { authenticate } = require('../middleware/authMiddleware');

// 所有路由需要登录
router.use(authenticate);

// ========== 节点类型 ==========
// 获取可用的节点类型列表
router.get('/node-types', AgentController.getNodeTypes);

// ========== 工作流管理 ==========
// 获取用户的工作流列表
router.get('/workflows', AgentController.getWorkflows);

// 获取单个工作流详情
router.get('/workflows/:id', AgentController.getWorkflowById);

// 创建工作流
router.post('/workflows', AgentController.createWorkflow);

// 更新工作流
router.put('/workflows/:id', AgentController.updateWorkflow);

// 删除工作流
router.delete('/workflows/:id', AgentController.deleteWorkflow);

// 切换工作流发布状态
router.patch('/workflows/:id/toggle-publish', AgentController.togglePublish);

// ========== 工作流执行 ==========
// 执行工作流
router.post('/workflows/:id/execute', AgentController.executeWorkflow);

// ========== 执行历史 ==========
// 获取执行历史列表
router.get('/executions', AgentController.getExecutions);

// 获取单个执行记录详情
router.get('/executions/:id', AgentController.getExecutionById);

// 删除执行记录
router.delete('/executions/:id', AgentController.deleteExecution);

// ========== 统计信息 ==========
// 获取用户统计信息
router.get('/stats', AgentController.getUserStats);

module.exports = router;
