/**
 * 用户标签路由 - 定义标签相关的API端点
 */

const express = require('express');
const UserTagController = require('../../controllers/admin/UserTagController');
const { requirePermission } = require('../../middleware/authMiddleware');

const router = express.Router();

// 所有标签路由都需要用户管理权限
router.use(requirePermission('user.manage'));

/**
 * @route GET /api/admin/user-tags/group/:groupId
 * @desc 获取组内所有标签
 * @access Admin / SuperAdmin
 */
router.get('/group/:groupId', UserTagController.getGroupTags);

/**
 * @route POST /api/admin/user-tags/batch-info
 * @desc 批量获取标签信息
 * @access Admin / SuperAdmin
 * @body { tag_ids: number[] }
 */
router.post('/batch-info', UserTagController.getBatchTagInfo);

/**
 * @route POST /api/admin/user-tags
 * @desc 创建标签
 * @access Admin / SuperAdmin
 */
router.post('/', UserTagController.createTag);

/**
 * @route PUT /api/admin/user-tags/:id
 * @desc 更新标签
 * @access Admin / SuperAdmin
 */
router.put('/:id', UserTagController.updateTag);

/**
 * @route DELETE /api/admin/user-tags/:id
 * @desc 删除标签
 * @access Admin / SuperAdmin
 */
router.delete('/:id', UserTagController.deleteTag);

/**
 * @route GET /api/admin/user-tags/user/:userId
 * @desc 获取用户的标签
 * @access Admin / SuperAdmin
 */
router.get('/user/:userId', UserTagController.getUserTags);

/**
 * @route PUT /api/admin/user-tags/user/:userId
 * @desc 更新用户的标签（覆盖式）
 * @access Admin / SuperAdmin
 */
router.put('/user/:userId', UserTagController.updateUserTags);

/**
 * @route POST /api/admin/user-tags/user/:userId/assign
 * @desc 批量为用户分配标签
 * @access Admin / SuperAdmin
 */
router.post('/user/:userId/assign', UserTagController.assignTagsToUser);

/**
 * @route POST /api/admin/user-tags/user/:userId/remove
 * @desc 移除用户的标签
 * @access Admin / SuperAdmin
 */
router.post('/user/:userId/remove', UserTagController.removeUserTags);

/**
 * @route POST /api/admin/user-tags/filter-users
 * @desc 根据标签筛选用户
 * @access Admin / SuperAdmin
 */
router.post('/filter-users', UserTagController.filterUsersByTags);

/**
 * @route GET /api/admin/user-tags/statistics/:groupId
 * @desc 获取标签统计
 * @access Admin / SuperAdmin
 */
router.get('/statistics/:groupId', UserTagController.getTagStatistics);

module.exports = router;
