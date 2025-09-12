/**
 * 知识模块路由
 */
const express = require('express');
const router = express.Router();
const KnowledgeModuleController = require('../controllers/KnowledgeModuleController');
const ModuleCombinationController = require('../controllers/ModuleCombinationController');
const { authenticate } = require('../middleware/authMiddleware'); // 修复：使用authenticate而不是authMiddleware

// 所有路由都需要认证
router.use(authenticate);

// 知识模块路由
router.get('/modules', KnowledgeModuleController.getModules);
router.get('/modules/categories', KnowledgeModuleController.getCategories);
router.get('/modules/group-tags', KnowledgeModuleController.getGroupTags); // 新增：获取组标签
router.get('/modules/:id', KnowledgeModuleController.getModule);
router.post('/modules', KnowledgeModuleController.createModule);
router.put('/modules/:id', KnowledgeModuleController.updateModule);
router.delete('/modules/:id', KnowledgeModuleController.deleteModule);

// 模块组合路由
router.get('/combinations', ModuleCombinationController.getCombinations);
router.get('/combinations/:id', ModuleCombinationController.getCombination);
router.post('/combinations', ModuleCombinationController.createCombination);
router.put('/combinations/:id', ModuleCombinationController.updateCombination);
router.delete('/combinations/:id', ModuleCombinationController.deleteCombination);

module.exports = router;
