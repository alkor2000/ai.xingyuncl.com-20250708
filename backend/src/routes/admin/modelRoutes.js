/**
 * AI模型管理路由
 */

const express = require('express');
const AIModelController = require('../../controllers/admin/AIModelController');
const { requirePermission } = require('../../middleware/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/models
 * @desc 获取AI模型管理
 * @access SuperAdmin
 */
router.get('/',
  requirePermission('system.all'),
  AIModelController.getAIModels
);

/**
 * @route POST /api/admin/models
 * @desc 创建AI模型配置
 * @access SuperAdmin
 */
router.post('/',
  requirePermission('system.all'),
  AIModelController.createAIModel
);

/**
 * @route PUT /api/admin/models/:id
 * @desc 更新AI模型配置 (支持积分配置)
 * @access SuperAdmin
 */
router.put('/:id',
  requirePermission('system.all'),
  AIModelController.updateAIModel
);

/**
 * @route POST /api/admin/models/:id/test
 * @desc 测试AI模型连通性
 * @access SuperAdmin
 */
router.post('/:id/test',
  requirePermission('system.all'),
  AIModelController.testAIModel
);

/**
 * @route DELETE /api/admin/models/:id
 * @desc 删除AI模型配置
 * @access SuperAdmin
 */
router.delete('/:id',
  requirePermission('system.all'),
  AIModelController.deleteAIModel
);

module.exports = router;
