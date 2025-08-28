/**
 * 存储积分配置路由
 */
const express = require('express');
const StorageCreditController = require('../../controllers/admin/StorageCreditController');
const { authenticate } = require('../../middleware/authMiddleware');
const { canManageSystem } = require('../../middleware/permissions');

const router = express.Router();

// 所有路由需要认证
router.use(authenticate);

// 获取配置 - 管理员可查看
router.get('/config', canManageSystem(), StorageCreditController.getConfig);

// 更新配置 - 只有超级管理员可修改
router.put('/config', canManageSystem(), StorageCreditController.updateConfig);

module.exports = router;
