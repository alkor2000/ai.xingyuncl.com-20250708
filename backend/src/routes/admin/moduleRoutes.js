/**
 * 系统模块路由
 */

const express = require('express');
const router = express.Router();
const ModuleController = require('../../controllers/admin/ModuleController');
const { requireSuperAdmin } = require('../../middleware/permissions/superAdminMiddleware');

// 获取用户可访问的模块（所有登录用户都可以访问）
router.get('/user-modules', ModuleController.getUserModules);

// 以下路由需要超级管理员权限
router.use(requireSuperAdmin());

// 获取所有模块
router.get('/', ModuleController.getModules);

// 获取单个模块
router.get('/:id', ModuleController.getModule);

// 创建模块
router.post('/', ModuleController.createModule);

// 更新模块
router.put('/:id', ModuleController.updateModule);

// 删除模块
router.delete('/:id', ModuleController.deleteModule);

// 切换模块状态
router.patch('/:id/toggle-status', ModuleController.toggleModuleStatus);

// 模块健康检查
router.post('/:id/check-health', ModuleController.checkModuleHealth);

module.exports = router;
