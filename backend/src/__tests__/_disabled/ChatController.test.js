/**
 * ChatController 单元测试
 */

const ChatController = require('../../../../controllers/chatController');
const Conversation = require('../../../../models/Conversation');
const Message = require('../../../../models/Message');
const AIModel = require('../../../../models/AIModel');
const { mockRequest, mockResponse } = require('../../../utils/testHelpers');

// Mock依赖
jest.mock('../../../../models/Conversation');
jest.mock('../../../../models/Message');
jest.mock('../../../../models/AIModel');
jest.mock('../../../../services/aiService');
jest.mock('../../../../utils/logger');

describe('ChatController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getConversations', () => {
    it('应该返回用户的会话列表', async () => {
      req = mockRequest({
        user: { id: 1 },
        query: { page: '1', limit: '20' }
      });
      res = mockResponse();

      const mockConversations = [
        { id: 1, title: 'Chat 1', user_id: 1 },
        { id: 2, title: 'Chat 2', user_id: 1 }
      ];

      Conversation.getUserConversations.mockResolvedValue({
        conversations: mockConversations,
        pagination: { page: 1, limit: 20, total: 2 }
      });

      await ChatController.getConversations(req, res);

      expect(Conversation.getUserConversations).toHaveBeenCalledWith(1, {
        page: 1,
        limit: 20
      });
      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data).toEqual(mockConversations);
    });
  });

  describe('createConversation', () => {
    it('应该创建新会话', async () => {
      req = mockRequest({
        user: { id: 1 },
        body: {
          title: 'New Chat',
          model_name: 'gpt-3.5-turbo',
          context_length: 20,
          ai_temperature: 0.7
        }
      });
      res = mockResponse();

      const mockModel = {
        name: 'gpt-3.5-turbo',
        is_active: true
      };

      const mockConversation = {
        id: 1,
        user_id: 1,
        title: 'New Chat',
        model_name: 'gpt-3.5-turbo',
        toJSON: function() { return this; }
      };

      AIModel.findByName.mockResolvedValue(mockModel);
      Conversation.create.mockResolvedValue(mockConversation);

      await ChatController.createConversation(req, res);

      expect(AIModel.findByName).toHaveBeenCalledWith('gpt-3.5-turbo');
      expect(Conversation.create).toHaveBeenCalled();
      expect(res.statusCode).toBe(201);
      expect(res.data.data.title).toBe('New Chat');
    });

    it('应该拒绝无效的模型', async () => {
      req = mockRequest({
        user: { id: 1 },
        body: {
          model_name: 'invalid-model'
        }
      });
      res = mockResponse();

      AIModel.findByName.mockResolvedValue(null);

      await ChatController.createConversation(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.data.success).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('应该检查用户积分是否充足', async () => {
      req = mockRequest({
        user: { id: 1 },
        params: { id: '1' },
        body: { content: 'Hello AI' }
      });
      res = mockResponse();

      const mockConversation = {
        id: 1,
        user_id: 1,
        model_name: 'gpt-3.5-turbo'
      };

      const mockModel = {
        name: 'gpt-3.5-turbo',
        credits_per_chat: 10
      };

      const mockUser = {
        id: 1,
        credits_stats: {
          remaining: 5 // 积分不足
        }
      };

      Conversation.checkOwnership.mockResolvedValue(true);
      Conversation.findById.mockResolvedValue(mockConversation);
      AIModel.findByName.mockResolvedValue(mockModel);
      
      // Mock User.findById
      const User = require('../../../../models/User');
      jest.mock('../../../../models/User');
      User.findById.mockResolvedValue(mockUser);

      await ChatController.sendMessage(req, res);

      expect(res.statusCode).toBe(402);
      expect(res.data.message).toContain('积分不足');
    });
  });
});
