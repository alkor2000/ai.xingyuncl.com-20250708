/**
 * 系统提示词管理路由
 */

const express = require('express');
const SystemPromptController = require('../../controllers/admin/SystemPromptController');
const { requireRole } = require('../../middleware/authMiddleware');

const router = express.Router();

// 所有路由都需要超级管理员权限
router.use(requireRole(['super_admin']));

/**
 * @route GET /api/admin/system-prompts
 * @desc 获取系统提示词列表
 */
router.get('/', SystemPromptController.getSystemPrompts);

/**
 * @route GET /api/admin/system-prompts/status
 * @desc 获取系统提示词功能状态
 */
router.get('/status', SystemPromptController.getSystemPromptsStatus);

/**
 * @route GET /api/admin/system-prompts/:id
 * @desc 获取单个系统提示词详情
 */
router.get('/:id', SystemPromptController.getSystemPrompt);

/**
 * @route POST /api/admin/system-prompts
 * @desc 创建系统提示词
 */
router.post('/', SystemPromptController.createSystemPrompt);

/**
 * @route PUT /api/admin/system-prompts/toggle
 * @desc 切换系统提示词功能开关
 */
router.put('/toggle', SystemPromptController.toggleSystemPromptsFeature);

/**
 * @route PUT /api/admin/system-prompts/:id
 * @desc 更新系统提示词
 */
router.put('/:id', SystemPromptController.updateSystemPrompt);

/**
 * @route DELETE /api/admin/system-prompts/:id
 * @desc 删除系统提示词
 */
router.delete('/:id', SystemPromptController.deleteSystemPrompt);

module.exports = router;
