/**
 * Agent节点类型管理路由（超级管理员）
 */

const express = require('express');
const router = express.Router();
const AgentNodeTypeController = require('../../controllers/admin/AgentNodeTypeController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requireSuperAdmin } = require('../../middleware/permissions/superAdminMiddleware');

// 需要超级管理员权限
router.use(authenticate);
router.use(requireSuperAdmin());

// 获取所有节点类型（包括未激活的）
router.get('/', AgentNodeTypeController.getAllNodeTypes);

// 创建节点类型
router.post('/', AgentNodeTypeController.createNodeType);

// 更新节点类型
router.put('/:id', AgentNodeTypeController.updateNodeType);

// 删除节点类型
router.delete('/:id', AgentNodeTypeController.deleteNodeType);

// 切换激活状态
router.patch('/:id/toggle', AgentNodeTypeController.toggleActive);

module.exports = router;
