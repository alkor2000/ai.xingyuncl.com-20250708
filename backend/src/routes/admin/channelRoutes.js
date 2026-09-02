/**
 * AI渠道管理路由
 * 渠道 = API接入点(名称+Base URL+Key)，供创建/编辑AI模型时选择复用
 * 权限与AI模型管理一致：仅超级管理员可操作(canManageAIModels)
 */

const express = require('express');
const AIChannelController = require('../../controllers/admin/AIChannelController');
const { canManageAIModels } = require('../../middleware/permissions');

const router = express.Router();

/**
 * @route GET /api/admin/channels
 * @desc 获取渠道列表(密钥脱敏)
 * @access SuperAdmin
 */
router.get('/', canManageAIModels(), AIChannelController.getChannels);

/**
 * @route POST /api/admin/channels
 * @desc 创建渠道
 * @access SuperAdmin
 */
router.post('/', canManageAIModels(), AIChannelController.createChannel);

/**
 * @route PUT /api/admin/channels/:id
 * @desc 更新渠道(api_key留空表示保持不变)
 * @access SuperAdmin
 */
router.put('/:id', canManageAIModels(), AIChannelController.updateChannel);

/**
 * @route DELETE /api/admin/channels/:id
 * @desc 删除渠道
 * @access SuperAdmin
 */
router.delete('/:id', canManageAIModels(), AIChannelController.deleteChannel);

module.exports = router;
