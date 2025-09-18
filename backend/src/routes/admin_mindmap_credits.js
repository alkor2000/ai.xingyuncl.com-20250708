/**
 * 管理员思维导图积分配置路由
 */
const express = require('express');
const router = express.Router();
const MindmapCreditsController = require('../controllers/admin/MindmapCreditsController');

// 获取思维导图积分配置
router.get('/mindmap-credits/config', MindmapCreditsController.getConfig);

// 更新思维导图积分配置
router.put('/mindmap-credits/config', MindmapCreditsController.updateConfig);

module.exports = router;
