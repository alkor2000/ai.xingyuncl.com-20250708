/**
 * AI模型管理路由 - 支持模型分组管理和拖拽排序
 * 
 * v1.1 新增批量排序接口 PUT /sort-order - 2026-02-27
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
 * @route PUT /api/admin/models/sort-order
 * @desc 批量更新模型排序 - 支持拖拽排序
 * @access SuperAdmin
 * @note 必须放在 /:id 路由之前，否则 sort-order 会被当作 :id 参数
 */
router.put('/sort-order', canManageAIModels(), AIModelController.updateSortOrder);

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

/**
 * @route GET /api/admin/models/:id/groups
 * @desc 获取模型已分配的用户组 - 只有超级管理员可操作
 * @access SuperAdmin
 */
router.get('/:id/groups', canManageAIModels(), AIModelController.getModelGroups);

/**
 * @route PUT /api/admin/models/:id/groups
 * @desc 更新模型的用户组分配 - 只有超级管理员可操作
 * @access SuperAdmin
 */
router.put('/:id/groups', canManageAIModels(), AIModelController.updateModelGroups);

module.exports = router;
