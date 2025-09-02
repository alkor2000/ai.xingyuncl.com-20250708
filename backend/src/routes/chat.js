/**
 * 对话路由 - 使用重构后的控制器
 */

const express = require('express');
const ChatControllerRefactored = require('../controllers/ChatControllerRefactored');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');
const { uploadImage } = require('../middleware/uploadMiddleware');
const { uploadDocument } = require('../middleware/documentUploadMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// AI对话限流配置
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 15, // 每分钟最多15次对话请求
  message: {
    success: false,
    code: 429,
    message: '对话频率过高，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 文件上传限流
const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 30, // 每分钟最多30次上传
  message: {
    success: false,
    code: 429,
    message: '上传频率过高，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 用户积分查询限流
const creditsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 60, // 每分钟最多60次积分查询
  message: {
    success: false,
    code: 429,
    message: '积分查询过于频繁，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 草稿操作限流
const draftLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 120, // 每分钟最多120次草稿操作
  message: {
    success: false,
    code: 429,
    message: '草稿操作过于频繁，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 消息操作限流
const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 30, // 每分钟最多30次消息操作
  message: {
    success: false,
    code: 429,
    message: '消息操作过于频繁，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

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
  creditsLimiter,
  requirePermission('chat.use'),
  ChatControllerRefactored.getUserCredits
);

/**
 * @route POST /api/chat/upload-image
 * @desc 上传聊天图片
 * @access Private
 */
router.post('/upload-image',
  uploadLimiter,
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
  uploadLimiter,
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
 * @desc 发送消息并获取AI回复
 * @access Private
 */
router.post('/conversations/:id/messages',
  chatLimiter,
  requirePermission('chat.use'),
  ChatControllerRefactored.sendMessage
);

/**
 * @route DELETE /api/chat/conversations/:id/messages/:messageId
 * @desc 删除消息对
 * @access Private
 */
router.delete('/conversations/:id/messages/:messageId',
  messageLimiter,
  requirePermission('chat.use'),
  ChatControllerRefactored.deleteMessagePair
);

/**
 * @route POST /api/chat/conversations/:id/clear
 * @desc 清空对话消息
 * @access Private
 */
router.post('/conversations/:id/clear',
  messageLimiter,
  requirePermission('chat.use'),
  ChatControllerRefactored.clearMessages
);

/**
 * @route POST /api/chat/conversations/:id/draft
 * @desc 保存对话草稿
 * @access Private
 */
router.post('/conversations/:id/draft',
  draftLimiter,
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
