/**
 * 对话路由 - 集成积分管理
 */

const express = require('express');
const ChatController = require('../controllers/chatController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// AI对话限流配置 - 调整限流，考虑积分限制
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 15, // 每分钟最多15次对话请求（积分已经是天然限流）
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

// 用户积分查询限流 - 较宽松
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

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/chat/models
 * @desc 获取可用的AI模型列表 (含积分信息)
 * @access Private
 */
router.get('/models', ChatController.getModels);

/**
 * @route GET /api/chat/credits
 * @desc 获取用户积分状态
 * @access Private
 */
router.get('/credits',
  creditsLimiter,
  requirePermission('chat.use'),
  ChatController.getUserCredits
);

/**
 * @route GET /api/chat/conversations
 * @desc 获取用户的会话列表
 * @access Private
 */
router.get('/conversations', 
  requirePermission('chat.use'),
  ChatController.getConversations
);

/**
 * @route POST /api/chat/conversations
 * @desc 创建新会话
 * @access Private
 */
router.post('/conversations',
  requirePermission('chat.use'),
  ChatController.createConversation
);

/**
 * @route GET /api/chat/conversations/:id
 * @desc 获取会话详情
 * @access Private
 */
router.get('/conversations/:id',
  requirePermission('chat.use'),
  ChatController.getConversation
);

/**
 * @route PUT /api/chat/conversations/:id
 * @desc 更新会话
 * @access Private
 */
router.put('/conversations/:id',
  requirePermission('chat.use'),
  ChatController.updateConversation
);

/**
 * @route DELETE /api/chat/conversations/:id
 * @desc 删除会话
 * @access Private
 */
router.delete('/conversations/:id',
  requirePermission('chat.use'),
  ChatController.deleteConversation
);

/**
 * @route GET /api/chat/conversations/:id/messages
 * @desc 获取会话消息列表
 * @access Private
 */
router.get('/conversations/:id/messages',
  requirePermission('chat.use'),
  ChatController.getMessages
);

/**
 * @route POST /api/chat/conversations/:id/messages
 * @desc 发送消息并获取AI回复 (积分扣减)
 * @access Private
 */
router.post('/conversations/:id/messages',
  chatLimiter,
  requirePermission('chat.use'),
  ChatController.sendMessage
);

module.exports = router;
