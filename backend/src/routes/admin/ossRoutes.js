/**
 * OSS配置管理路由
 */

const express = require('express');
const OSSConfigController = require('../../controllers/admin/OSSConfigController');
const { authenticate } = require('../../middleware/authMiddleware');
const { canManageSystem } = require('../../middleware/permissions');

const router = express.Router();

// 所有路由都需要超级管理员权限

// OSS配置
router.get('/config', canManageSystem(), OSSConfigController.getConfig);
router.post('/config', canManageSystem(), OSSConfigController.saveConfig);
router.post('/test', canManageSystem(), OSSConfigController.testConnection);

// 积分配置
router.get('/credit-config', canManageSystem(), OSSConfigController.getCreditConfig);
router.put('/credit-config', canManageSystem(), OSSConfigController.updateCreditConfig);

// 统计
router.get('/stats', canManageSystem(), OSSConfigController.getStorageStats);

module.exports = router;
