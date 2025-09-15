/**
 * 机构申请路由 - 修复配置获取
 */

const express = require('express');
const OrgApplicationController = require('../../controllers/admin/OrgApplicationController');
const { authenticate } = require('../../middleware/authMiddleware');
const { canManageSystem } = require('../../middleware/permissions');

const router = express.Router();

// 公开路由（不需要认证）
router.get('/form-config', OrgApplicationController.getFormConfig);
router.post('/submit', OrgApplicationController.submitApplication);

// 需要认证和权限的路由
router.use(authenticate);
router.use(canManageSystem()); // 只有超级管理员可以管理

// 申请管理
router.get('/applications', OrgApplicationController.getApplicationList);
router.post('/applications/:id/approve', OrgApplicationController.approveApplication);

// 表单配置管理 - 添加管理员专用的获取配置接口
router.get('/admin-form-config', OrgApplicationController.getAdminFormConfig); // 新增：获取完整配置
router.put('/form-config', OrgApplicationController.updateFormConfig);

// 邀请码管理
router.get('/invitation-codes', OrgApplicationController.getInvitationCodes);
router.post('/invitation-codes', OrgApplicationController.createInvitationCode);
router.put('/invitation-codes/:id', OrgApplicationController.updateInvitationCode);
router.delete('/invitation-codes/:id', OrgApplicationController.deleteInvitationCode);

module.exports = router;
