/**
 * AI模型管理路由 - 使用优化的权限中间件
 */

const express = require('express');
const AIModelController = require('../../controllers/admin/AIModelController');
const { requirePermission } = require('../../middleware/authMiddleware');
const { canManageAIModels } = require('../../middleware/permissions');

const router = express.Router();

/**
 * @route GET /api/admin/models
 * @desc 获取AI模型列表
 * @access SuperAdmin only
 */
router.get('/',
  requirePermission('system.all'),
  canManageAIModels(),
  AIModelController.getAIModels
);

/**
 * @route POST /api/admin/models
 * @desc 创建AI模型配置
 * @access SuperAdmin only
 */
router.post('/',
  requirePermission('system.all'),
  canManageAIModels(),
  AIModelController.createAIModel
);

/**
 * @route PUT /api/admin/models/:id
 * @desc 更新AI模型配置 (支持积分配置)
 * @access SuperAdmin only
 */
router.put('/:id',
  requirePermission('system.all'),
  canManageAIModels(),
  AIModelController.updateAIModel
);

/**
 * @route POST /api/admin/models/:id/test
 * @desc 测试AI模型连通性
 * @access SuperAdmin only
 */
router.post('/:id/test',
  requirePermission('system.all'),
  canManageAIModels(),
  AIModelController.testAIModel
);

/**
 * @route DELETE /api/admin/models/:id
 * @desc 删除AI模型配置
 * @access SuperAdmin only
 */
router.delete('/:id',
  requirePermission('system.all'),
  canManageAIModels(),
  AIModelController.deleteAIModel
);

module.exports = router;
