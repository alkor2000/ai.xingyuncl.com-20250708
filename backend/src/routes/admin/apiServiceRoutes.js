/**
 * API服务管理路由
 */

const express = require('express');
const APIServiceController = require('../../controllers/admin/APIServiceController');
const { canManageSystem } = require('../../middleware/permissions');

const router = express.Router();

// 获取所有API服务
router.get('/', 
  canManageSystem(),
  APIServiceController.getServices
);

// 获取单个API服务
router.get('/:serviceId',
  canManageSystem(),
  APIServiceController.getService
);

// 创建API服务
router.post('/',
  canManageSystem(),
  APIServiceController.createService
);

// 更新API服务
router.put('/:serviceId',
  canManageSystem(),
  APIServiceController.updateService
);

// 重置API密钥
router.post('/:serviceId/reset-key',
  canManageSystem(),
  APIServiceController.resetApiKey
);

// 删除API服务
router.delete('/:serviceId',
  canManageSystem(),
  APIServiceController.deleteService
);

// 获取服务的操作配置
router.get('/:serviceId/actions',
  canManageSystem(),
  APIServiceController.getServiceActions
);

// 创建或更新服务操作配置
router.post('/:serviceId/actions',
  canManageSystem(),
  APIServiceController.upsertServiceAction
);

// 删除服务操作配置
router.delete('/:serviceId/actions/:actionType',
  canManageSystem(),
  APIServiceController.deleteServiceAction
);

// 获取服务统计
router.get('/:serviceId/stats',
  canManageSystem(),
  APIServiceController.getServiceStats
);

module.exports = router;
