/**
 * 教学系统路由（增强版）
 * 定义教学模块、课程、权限的API端点
 * 新增：管理员全局数据管理路由
 */

const express = require('express');
const TeachingController = require('../controllers/TeachingController');
const { authenticate } = require('../middleware/authMiddleware');
const {
  canCreateModule,
  canEditModule,
  canViewModule,
  canDeleteModule,
  canViewLesson,
  canEditLesson,
  canManagePermissions
} = require('../middleware/teachingPermissions');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticate);

// ==================== 管理员路由（新增）====================

/**
 * @route   GET /api/teaching/admin/modules
 * @desc    获取所有教学模块（管理员视角，不受权限限制）
 * @access  仅超级管理员
 */
router.get('/admin/modules', TeachingController.getAllModules);

/**
 * @route   POST /api/teaching/admin/modules/batch-update
 * @desc    批量更新模块状态
 * @access  仅超级管理员
 */
router.post('/admin/modules/batch-update', TeachingController.batchUpdateModules);

// ==================== 教学模块路由 ====================

/**
 * @route   POST /api/teaching/modules
 * @desc    创建教学模块
 * @access  开发者、管理员
 */
router.post('/modules', canCreateModule(), TeachingController.createModule);

/**
 * @route   GET /api/teaching/modules
 * @desc    获取模块列表（根据权限自动过滤）
 * @access  所有认证用户
 */
router.get('/modules', TeachingController.getModules);

/**
 * @route   GET /api/teaching/modules/:id
 * @desc    获取模块详情
 * @access  有查看权限的用户
 */
router.get('/modules/:id', canViewModule(), TeachingController.getModule);

/**
 * @route   PUT /api/teaching/modules/:id
 * @desc    更新模块信息
 * @access  有编辑权限的用户
 */
router.put('/modules/:id', canEditModule(), TeachingController.updateModule);

/**
 * @route   DELETE /api/teaching/modules/:id
 * @desc    删除模块
 * @access  创建者、管理员
 */
router.delete('/modules/:id', canDeleteModule(), TeachingController.deleteModule);

// ==================== 课程路由 ====================

/**
 * @route   POST /api/teaching/lessons
 * @desc    创建课程
 * @access  有模块编辑权限的用户
 */
router.post('/lessons', TeachingController.createLesson);

/**
 * @route   GET /api/teaching/modules/:moduleId/lessons
 * @desc    获取模块的课程列表（根据用户角色自动过滤内容类型）
 * @access  有模块查看权限的用户
 */
router.get('/modules/:moduleId/lessons', TeachingController.getModuleLessons);

/**
 * @route   GET /api/teaching/lessons/:id
 * @desc    获取课程详情（包含完整内容）
 * @access  有课程查看权限的用户
 */
router.get('/lessons/:id', canViewLesson(), TeachingController.getLesson);

/**
 * @route   PUT /api/teaching/lessons/:id
 * @desc    更新课程信息
 * @access  有模块编辑权限的用户
 */
router.put('/lessons/:id', canEditLesson(), TeachingController.updateLesson);

/**
 * @route   DELETE /api/teaching/lessons/:id
 * @desc    删除课程
 * @access  有模块编辑权限的用户
 */
router.delete('/lessons/:id', canEditLesson(), TeachingController.deleteLesson);

// ==================== 权限管理路由 ====================

/**
 * @route   GET /api/teaching/modules/:moduleId/permissions
 * @desc    获取模块的权限列表
 * @access  管理员
 */
router.get(
  '/modules/:moduleId/permissions',
  canManagePermissions(),
  TeachingController.getModulePermissions
);

/**
 * @route   POST /api/teaching/permissions
 * @desc    授予权限
 * @access  管理员
 */
router.post(
  '/permissions',
  canManagePermissions(),
  TeachingController.grantPermission
);

/**
 * @route   DELETE /api/teaching/permissions/:permissionId
 * @desc    撤销单个权限
 * @access  管理员
 */
router.delete(
  '/permissions/:permissionId',
  canManagePermissions(),
  TeachingController.revokePermission
);

/**
 * @route   POST /api/teaching/permissions/revoke-multiple
 * @desc    批量撤销权限
 * @access  管理员
 */
router.post(
  '/permissions/revoke-multiple',
  canManagePermissions(),
  TeachingController.revokeMultiplePermissions
);

// ==================== 草稿管理路由 ====================

/**
 * @route   POST /api/teaching/drafts/autosave
 * @desc    自动保存课程草稿
 * @access  有编辑权限的用户
 */
router.post('/drafts/autosave', TeachingController.saveDraft);

/**
 * @route   GET /api/teaching/drafts/:lessonId
 * @desc    获取课程草稿
 * @access  草稿创建者
 */
router.get('/drafts/:lessonId', TeachingController.getDraft);

// ==================== 浏览记录路由 ====================

/**
 * @route   POST /api/teaching/view-logs
 * @desc    记录浏览行为
 * @access  所有认证用户
 */
router.post('/view-logs', TeachingController.recordView);

module.exports = router;
