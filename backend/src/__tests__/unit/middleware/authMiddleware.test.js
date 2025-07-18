/**
 * 认证中间件单元测试
 */

const { authenticate, requirePermission } = require('../../../../middleware/authMiddleware');
const { mockRequest, mockResponse, generateTestToken } = require('../../../utils/testHelpers');
const User = require('../../../../models/User');
const jwt = require('jsonwebtoken');

// Mock依赖
jest.mock('../../../../models/User');
jest.mock('../../../../database/redis', () => ({
  isConnected: true,
  exists: jest.fn()
}));

describe('authMiddleware', () => {
  describe('authenticate', () => {
    let req, res, next;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      next = jest.fn();
      jest.clearAllMocks();
    });

    it('应该成功验证有效的token', async () => {
      const token = generateTestToken(1, 'user');
      req.headers['Authorization'] = `Bearer ${token}`;
      
      const mockUser = {
        id: 1,
        email: 'test1@example.com',
        role: 'user',
        status: 'active'
      };
      
      User.findById.mockResolvedValue(mockUser);
      const redisConnection = require('../../../../database/redis');
      redisConnection.exists.mockResolvedValue(false);

      await authenticate(req, res, next);

      expect(User.findById).toHaveBeenCalledWith(1);
      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
    });

    it('应该拒绝无token的请求', async () => {
      await authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.data.message).toBe('缺少认证令牌');
      expect(next).not.toHaveBeenCalled();
    });

    it('应该拒绝无效的token', async () => {
      req.headers['Authorization'] = 'Bearer invalid-token';

      await authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.data.message).toContain('无效');
      expect(next).not.toHaveBeenCalled();
    });

    it('应该支持从查询参数获取token（SSE支持）', async () => {
      const token = generateTestToken(1, 'user');
      req.query.token = token;
      
      User.findById.mockResolvedValue({
        id: 1,
        status: 'active'
      });
      const redisConnection = require('../../../../database/redis');
      redisConnection.exists.mockResolvedValue(false);

      await authenticate(req, res, next);

      expect(req.user).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('应该拒绝在黑名单中的token', async () => {
      const token = generateTestToken(1, 'user');
      req.headers['Authorization'] = `Bearer ${token}`;
      
      const redisConnection = require('../../../../database/redis');
      redisConnection.exists.mockResolvedValue(true);

      await authenticate(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.data.message).toBe('令牌已失效，请重新登录');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requirePermission', () => {
    it('应该生成权限检查中间件', () => {
      const middleware = requirePermission('admin.users.view');
      expect(typeof middleware).toBe('function');
    });

    it('应该允许有权限的用户通过', async () => {
      const req = mockRequest({
        user: {
          id: 1,
          role: 'admin',
          permissions: ['admin.users.view']
        }
      });
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('admin.users.view');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('应该拒绝无权限的用户', async () => {
      const req = mockRequest({
        user: {
          id: 1,
          role: 'user',
          permissions: []
        }
      });
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('admin.users.view');
      await middleware(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
