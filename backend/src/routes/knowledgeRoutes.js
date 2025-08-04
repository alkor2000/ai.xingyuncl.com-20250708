/**
 * 知识模块路由
 */

const express = require('express');
const KnowledgeModuleController = require('../controllers/KnowledgeModuleController');
const ModuleCombinationController = require('../controllers/ModuleCombinationController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticate);

// ===== 知识模块路由 =====

/**
 * @route GET /api/knowledge/modules
 * @desc 获取用户可用的知识模块列表
 */
router.get('/modules', KnowledgeModuleController.getModules);

/**
 * @route GET /api/knowledge/modules/categories
 * @desc 获取模块分类列表
 */
router.get('/modules/categories', KnowledgeModuleController.getCategories);

/**
 * @route GET /api/knowledge/modules/:id
 * @desc 获取单个知识模块详情
 */
router.get('/modules/:id', KnowledgeModuleController.getModule);

/**
 * @route POST /api/knowledge/modules
 * @desc 创建知识模块
 */
router.post('/modules', KnowledgeModuleController.createModule);

/**
 * @route PUT /api/knowledge/modules/:id
 * @desc 更新知识模块
 */
router.put('/modules/:id', KnowledgeModuleController.updateModule);

/**
 * @route DELETE /api/knowledge/modules/:id
 * @desc 删除知识模块
 */
router.delete('/modules/:id', KnowledgeModuleController.deleteModule);

// ===== 模块组合路由 =====

/**
 * @route GET /api/knowledge/combinations
 * @desc 获取用户的模块组合列表
 */
router.get('/combinations', ModuleCombinationController.getCombinations);

/**
 * @route GET /api/knowledge/combinations/:id
 * @desc 获取单个模块组合详情
 */
router.get('/combinations/:id', ModuleCombinationController.getCombination);

/**
 * @route GET /api/knowledge/combinations/:id/content
 * @desc 获取组合内容（用于对话）
 */
router.get('/combinations/:id/content', ModuleCombinationController.getCombinationContent);

/**
 * @route POST /api/knowledge/combinations
 * @desc 创建模块组合
 */
router.post('/combinations', ModuleCombinationController.createCombination);

/**
 * @route POST /api/knowledge/combinations/:id/copy
 * @desc 复制模块组合
 */
router.post('/combinations/:id/copy', ModuleCombinationController.copyCombination);

/**
 * @route PUT /api/knowledge/combinations/:id
 * @desc 更新模块组合
 */
router.put('/combinations/:id', ModuleCombinationController.updateCombination);

/**
 * @route DELETE /api/knowledge/combinations/:id
 * @desc 删除模块组合
 */
router.delete('/combinations/:id', ModuleCombinationController.deleteCombination);

module.exports = router;
