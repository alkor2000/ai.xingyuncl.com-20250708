/**
 * 教学系统路由（全局授权管理增强版 + 教案管理 + 组管理员授权）
 * 
 * 版本更新：
 * - v1.3.0 (2025-11-09): 支持组管理员二次授权
 *   * 组管理员可以访问授权管理接口
 *   * 权限检查在控制器中实现
 * 
 * - v1.2.0: 全局三级授权管理路由
 * - v1.1.0 (2025-10-29): 教案管理路由
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

// ==================== 分组管理路由 ====================

/**
 * @route   GET /api/teaching/groups
 * @desc    获取所有分组列表（所有用户可访问）
 * @access  所有认证用户
 */
router.get('/groups', TeachingController.getGroups);

/**
 * @route   POST /api/teaching/groups
 * @desc    创建分组
 * @access  仅超级管理员
 */
router.post('/groups', TeachingController.createGroup);

/**
 * @route   PUT /api/teaching/groups/:groupId
 * @desc    更新分组信息
 * @access  仅超级管理员
 */
router.put('/groups/:groupId', TeachingController.updateGroup);

/**
 * @route   DELETE /api/teaching/groups/:groupId
 * @desc    删除分组
 * @access  仅超级管理员
 */
router.delete('/groups/:groupId', TeachingController.deleteGroup);

/**
 * @route   GET /api/teaching/groups/:groupId/modules
 * @desc    获取分组的模块列表
 * @access  所有认证用户
 */
router.get('/groups/:groupId/modules', TeachingController.getGroupModules);

// ==================== 管理员路由 ====================

/**
 * @route   GET /api/teaching/admin/modules
 * @desc    获取所有教学模块（管理员视角）
 * @access  超级管理员查看所有，组管理员查看本组授权的模块
 * @update  v1.3.0: 支持组管理员访问
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
 * @desc    创建教学模块（增强：支持设置分组）
 * @access  开发者、管理员
 */
router.post('/modules', canCreateModule(), TeachingController.createModule);

/**
 * @route   GET /api/teaching/modules
 * @desc    获取模块列表（增强：支持按分组返回）
 * @access  所有认证用户
 * @query   group_by=group 按分组返回
 */
router.get('/modules', TeachingController.getModules);

/**
 * @route   GET /api/teaching/modules/:id
 * @desc    获取模块详情（增强：包含分组信息）
 * @access  有查看权限的用户
 */
router.get('/modules/:id', canViewModule(), TeachingController.getModule);

/**
 * @route   PUT /api/teaching/modules/:id
 * @desc    更新模块信息（增强：支持更新分组）
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

// ==================== 教案管理路由 ====================

/**
 * @route   POST /api/teaching/lessons/:id/teaching-plan
 * @desc    保存教案
 * @access  有课程编辑权限的用户
 */
router.post('/lessons/:id/teaching-plan', TeachingController.saveTeachingPlan);

/**
 * @route   GET /api/teaching/lessons/:id/teaching-plan/:pageNumber
 * @desc    获取教案
 * @access  有课程查看权限的用户
 */
router.get('/lessons/:id/teaching-plan/:pageNumber', TeachingController.getTeachingPlan);

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

// ==================== 全局授权管理路由（增强：支持组管理员）====================

/**
 * @route   POST /api/teaching/authorization/save
 * @desc    批量保存全局授权配置（组→标签→用户三级）
 * @access  超级管理员：可以管理所有组
 *          组管理员：只能管理本组，且只能分配已授权的模块
 * @update  v1.3.0: 支持组管理员二次授权
 */
router.post('/authorization/save', TeachingController.saveGlobalAuthorizations);

/**
 * @route   GET /api/teaching/authorization
 * @desc    获取全局授权配置列表
 * @access  超级管理员：获取所有组的配置
 *          组管理员：只获取本组的配置
 * @update  v1.3.0: 支持组管理员访问
 */
router.get('/authorization', TeachingController.getGlobalAuthorizations);

/**
 * @route   GET /api/teaching/tags/:tagId/users
 * @desc    获取标签下的用户列表（分页，用于授权管理）
 * @access  超级管理员、组管理员（只能查看本组标签）
 * @query   page=1&limit=20
 * @update  v1.3.0: 支持组管理员访问
 */
router.get('/tags/:tagId/users', TeachingController.getTagUsers);

/**
 * @route   GET /api/teaching/modules/:moduleId/lessons-for-auth
 * @desc    获取模块的课程列表（用于授权选择）
 * @access  超级管理员、组管理员（只能查看已授权的模块）
 * @update  v1.3.0: 支持组管理员访问
 */
router.get('/modules/:moduleId/lessons-for-auth', TeachingController.getModuleLessonsForAuth);

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
