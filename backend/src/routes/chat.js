/**
 * 对话路由
 */

const express = require('express');
const ChatController = require('../controllers/chatController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// AI对话限流配置
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 20, // 每分钟最多20次对话请求
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

// 所有路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/chat/models
 * @desc 获取可用的AI模型列表
 * @access Private
 */
router.get('/models', ChatController.getModels);

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
 * @desc 发送消息并获取AI回复
 * @access Private
 */
router.post('/conversations/:id/messages',
  chatLimiter,
  requirePermission('chat.use'),
  // 移除了checkTokenQuota中间件，在控制器内部处理
  ChatController.sendMessage
);

module.exports = router;
