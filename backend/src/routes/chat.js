/**
 * 对话路由 - 使用重构后的控制器
 * 
 * v1.1 (2026-03-01):
 *   - 移除硬编码rateLimit，改为通过rateLimitService动态获取
 *   - 对话限流纳入后台设置统一管理，支持enabled禁用
 *   - 与admin.js保持一致的动态限流模式
 * v1.0:
 *   - 5种硬编码限流(chat/upload/credits/draft/message)
 */

const express = require('express');
const ChatControllerRefactored = require('../controllers/ChatControllerRefactored');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');
const { uploadImage } = require('../middleware/uploadMiddleware');
const { uploadDocument } = require('../middleware/documentUploadMiddleware');
const rateLimitService = require('../services/rateLimitService');

const router = express.Router();

/**
 * v1.1 动态对话限流中间件
 * 通过rateLimitService获取，后台可配置，支持enabled禁用
 */
const dynamicChatLimiter = async (req, res, next) => {
  try {
    const limiter = await rateLimitService.getLimiter('chat');
    limiter(req, res, next);
  } catch (error) {
    // 获取限制器失败时不阻塞请求
    next();
  }
};

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/chat/models
 * @desc 获取可用的AI模型列表
 * @access Private
 */
router.get('/models', ChatControllerRefactored.getModels);

/**
 * @route GET /api/chat/system-prompts
 * @desc 获取可用的系统提示词列表
 * @access Private
 */
router.get('/system-prompts', 
  requirePermission('chat.use'),
  ChatControllerRefactored.getSystemPrompts
);

/**
 * @route GET /api/chat/module-combinations
 * @desc 获取用户的模块组合列表
 * @access Private
 */
router.get('/module-combinations', 
  requirePermission('chat.use'),
  ChatControllerRefactored.getModuleCombinations
);

/**
 * @route GET /api/chat/credits
 * @desc 获取用户积分状态
 * @access Private
 */
router.get('/credits',
  requirePermission('chat.use'),
  ChatControllerRefactored.getUserCredits
);

/**
 * @route POST /api/chat/upload-image
 * @desc 上传聊天图片
 * @access Private
 */
router.post('/upload-image',
  requirePermission('chat.use'),
  uploadImage,
  ChatControllerRefactored.uploadImage
);

/**
 * @route POST /api/chat/upload-document
 * @desc 上传聊天文档
 * @access Private
 */
router.post('/upload-document',
  requirePermission('chat.use'),
  uploadDocument,
  ChatControllerRefactored.uploadDocument
);

/**
 * @route GET /api/chat/conversations
 * @desc 获取用户的会话列表
 * @access Private
 */
router.get('/conversations', 
  requirePermission('chat.use'),
  ChatControllerRefactored.getConversations
);

/**
 * @route POST /api/chat/conversations
 * @desc 创建新会话
 * @access Private
 */
router.post('/conversations',
  requirePermission('chat.use'),
  ChatControllerRefactored.createConversation
);

/**
 * @route GET /api/chat/conversations/:id
 * @desc 获取会话详情
 * @access Private
 */
router.get('/conversations/:id',
  requirePermission('chat.use'),
  ChatControllerRefactored.getConversation
);

/**
 * @route PUT /api/chat/conversations/:id
 * @desc 更新会话
 * @access Private
 */
router.put('/conversations/:id',
  requirePermission('chat.use'),
  ChatControllerRefactored.updateConversation
);

/**
 * @route DELETE /api/chat/conversations/:id
 * @desc 删除会话
 * @access Private
 */
router.delete('/conversations/:id',
  requirePermission('chat.use'),
  ChatControllerRefactored.deleteConversation
);

/**
 * @route GET /api/chat/conversations/:id/messages
 * @desc 获取会话消息列表
 * @access Private
 */
router.get('/conversations/:id/messages',
  requirePermission('chat.use'),
  ChatControllerRefactored.getMessages
);

/**
 * @route POST /api/chat/conversations/:id/messages
 * @desc 发送消息并获取AI回复（受对话限流保护）
 * @access Private
 */
router.post('/conversations/:id/messages',
  dynamicChatLimiter,
  requirePermission('chat.use'),
  ChatControllerRefactored.sendMessage
);

/**
 * @route DELETE /api/chat/conversations/:id/messages/:messageId
 * @desc 删除消息对
 * @access Private
 */
router.delete('/conversations/:id/messages/:messageId',
  requirePermission('chat.use'),
  ChatControllerRefactored.deleteMessagePair
);

/**
 * @route POST /api/chat/conversations/:id/clear
 * @desc 清空对话消息
 * @access Private
 */
router.post('/conversations/:id/clear',
  requirePermission('chat.use'),
  ChatControllerRefactored.clearMessages
);

/**
 * @route POST /api/chat/conversations/:id/draft
 * @desc 保存对话草稿
 * @access Private
 */
router.post('/conversations/:id/draft',
  requirePermission('chat.use'),
  ChatControllerRefactored.saveDraft
);

/**
 * @route GET /api/chat/conversations/:id/draft
 * @desc 获取对话草稿
 * @access Private
 */
router.get('/conversations/:id/draft',
  requirePermission('chat.use'),
  ChatControllerRefactored.getDraft
);

/**
 * @route DELETE /api/chat/conversations/:id/draft
 * @desc 删除对话草稿
 * @access Private
 */
router.delete('/conversations/:id/draft',
  requirePermission('chat.use'),
  ChatControllerRefactored.deleteDraft
);

module.exports = router;
