/**
 * AI模型管理路由
 */

const express = require('express');
const AIModelController = require('../../controllers/admin/AIModelController');
const { canViewAIModels, canManageAIModels } = require('../../middleware/permissions');

const router = express.Router();

/**
 * @route GET /api/admin/models
 * @desc 获取AI模型列表 - 超级管理员和组管理员可查看
 * @access Admin
 */
router.get('/', canViewAIModels(), AIModelController.getAIModels);

/**
 * @route POST /api/admin/models
 * @desc 创建AI模型 - 只有超级管理员可操作
 * @access SuperAdmin
 */
router.post('/', canManageAIModels(), AIModelController.createAIModel);

/**
 * @route PUT /api/admin/models/:id
 * @desc 更新AI模型 - 只有超级管理员可操作
 * @access SuperAdmin
 */
router.put('/:id', canManageAIModels(), AIModelController.updateAIModel);

/**
 * @route DELETE /api/admin/models/:id
 * @desc 删除AI模型 - 只有超级管理员可操作
 * @access SuperAdmin
 */
router.delete('/:id', canManageAIModels(), AIModelController.deleteAIModel);

/**
 * @route POST /api/admin/models/:id/test
 * @desc 测试AI模型连通性 - 超级管理员和组管理员可操作
 * @access Admin
 */
router.post('/:id/test', canViewAIModels(), AIModelController.testAIModel);

module.exports = router;
