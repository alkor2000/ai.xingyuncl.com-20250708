/**
 * authMiddleware - 认证中间件单元测试
 * 
 * 测试范围：
 * - authenticate()        JWT认证（Token提取、验证、黑名单、用户状态、账号有效期）
 * - requireRole()         角色检查
 * - requirePermission()   权限检查（含通配符、组权限映射）
 * - requireGroupPermission() 组权限检查
 * 
 * Mock策略：
 * - jwt.verify 用真实签名验证，通过生成合法Token测试
 * - User.findById 返回Mock用户对象
 * - Redis 模拟黑名单查询
 * - req/res 使用自定义Mock对象
 */

// ========== Mock外部依赖 ==========

const mockFindById = jest.fn();
jest.mock('../../../models/User', () => ({
  findById: mockFindById
}));

jest.mock('../../../config', () => ({
  auth: {
    jwt: {
      accessSecret: 'test-access-secret-key-for-middleware-test!!',
      refreshSecret: 'test-refresh-secret-key-for-middleware-test!!',
      accessExpiresIn: '15m',
      issuer: 'ai-platform-test',
      audience: 'ai-platform-users-test'
    }
  }
}));

jest.mock('../../../database/redis', () => ({
  isConnected: true,
  exists: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块 ==========
const jwt = require('jsonwebtoken');
const { authenticate, requireRole, requirePermission } = require('../../../middleware/authMiddleware');
const config = require('../../../config');
const redisConnection = require('../../../database/redis');

// ========== 辅助函数 ==========

/**
 * 生成合法的accessToken用于测试
 */
function generateTestAccessToken(payload = {}) {
  const defaultPayload = {
    userId: 1,
    email: 'test@example.com',
    username: 'testuser',
    role: 'user',
    type: 'access',
    jti: `test-${Date.now()}`
  };

  return jwt.sign(
    { ...defaultPayload, ...payload },
    config.auth.jwt.accessSecret,
    { expiresIn: '15m' }
  );
}

/**
 * 创建Mock请求对象
 */
function createMockReq(overrides = {}) {
  return {
    header: jest.fn((name) => {
      if (name === 'Authorization' && overrides.token) {
        return `Bearer ${overrides.token}`;
      }
      return overrides.headers?.[name] || null;
    }),
    query: overrides.query || {},
    params: overrides.params || {},
    body: overrides.body || {},
    path: overrides.path || '/test',
    user: overrides.user || null,
    token: null,
    tokenPayload: null
  };
}

/**
 * 创建Mock响应对象（捕获状态码和返回数据）
 */
function createMockRes() {
  const res = {
    statusCode: null,
    responseData: null,
    status: jest.fn(function(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function(data) {
      this.responseData = data;
      return this;
    })
  };
  return res;
}

/**
 * 创建Mock用户（模拟User实例）
 */
function createMockUser(overrides = {}) {
  return {
    id: 1,
    email: 'test@example.com',
    username: 'testuser',
    role: 'user',
    status: 'active',
    group_id: 1,
    expire_at: null,
    isAccountExpired: jest.fn().mockReturnValue(false),
    getAccountRemainingDays: jest.fn().mockReturnValue(null),
    getPermissions: jest.fn().mockResolvedValue(['user.manage']),
    hasPermission: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

// ========== 测试套件 ==========

describe('authMiddleware - 认证中间件', () => {

  // ---------- authenticate() 测试 ----------
  describe('authenticate() - JWT认证', () => {

    test('有效Token：应设置req.user并调用next', async () => {
      const token = generateTestAccessToken({ userId: 5 });
      const mockUser = createMockUser({ id: 5 });
      mockFindById.mockResolvedValue(mockUser);

      const req = createMockReq({ token });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBe(mockUser);
      expect(req.token).toBe(token);
      expect(req.tokenPayload).toBeDefined();
      expect(req.tokenPayload.userId).toBe(5);
    });

    test('无Token：应返回401', async () => {
      const req = createMockReq({});
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('认证令牌');
    });

    test('SSE查询参数Token：应正常认证', async () => {
      const token = generateTestAccessToken({ userId: 3 });
      const mockUser = createMockUser({ id: 3 });
      mockFindById.mockResolvedValue(mockUser);

      // 不在header里传token，而是在query里
      const req = createMockReq({ query: { token } });
      req.header = jest.fn().mockReturnValue(null); // 无Authorization头
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.id).toBe(3);
    });

    test('过期Token：应返回401并提示过期', async () => {
      const expiredToken = jwt.sign(
        { userId: 1, type: 'access', jti: 'exp-jti' },
        config.auth.jwt.accessSecret,
        { expiresIn: '0s' }
      );

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 100));

      const req = createMockReq({ token: expiredToken });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('过期');
    });

    test('无效签名Token：应返回401', async () => {
      const badToken = jwt.sign(
        { userId: 1, type: 'access', jti: 'bad-jti' },
        'wrong-secret-key-not-matching!!!!!',
        { expiresIn: '15m' }
      );

      const req = createMockReq({ token: badToken });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    test('Token在黑名单中：应返回401', async () => {
      const token = generateTestAccessToken();
      const mockUser = createMockUser();
      mockFindById.mockResolvedValue(mockUser);
      redisConnection.exists.mockResolvedValue(true); // 在黑名单

      const req = createMockReq({ token });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('失效');

      // 恢复
      redisConnection.exists.mockResolvedValue(false);
    });

    test('用户不存在：应返回401', async () => {
      const token = generateTestAccessToken({ userId: 999 });
      mockFindById.mockResolvedValue(null);

      const req = createMockReq({ token });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('用户不存在');
    });

    test('用户被禁用：应返回401', async () => {
      const token = generateTestAccessToken();
      const mockUser = createMockUser({ status: 'disabled' });
      mockFindById.mockResolvedValue(mockUser);

      const req = createMockReq({ token });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('禁用');
    });

    test('账号已过期：应返回401并提示过期天数', async () => {
      const token = generateTestAccessToken();
      const mockUser = createMockUser({
        isAccountExpired: jest.fn().mockReturnValue(true),
        getAccountRemainingDays: jest.fn().mockReturnValue(-5)
      });
      mockFindById.mockResolvedValue(mockUser);

      const req = createMockReq({ token });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('过期');
      expect(res.responseData.message).toContain('5');
    });

    test('refreshToken当作accessToken用：应返回401（type不匹配）', async () => {
      const refreshToken = jwt.sign(
        { userId: 1, type: 'refresh', jti: 'refresh-jti' },
        config.auth.jwt.accessSecret, // 用相同secret但type不同
        { expiresIn: '14d' }
      );

      const req = createMockReq({ token: refreshToken });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.responseData.message).toContain('令牌类型');
    });
  });

  // ---------- requireRole() 测试 ----------
  describe('requireRole() - 角色检查', () => {

    test('用户角色匹配：应调用next', () => {
      const middleware = requireRole(['admin', 'super_admin']);
      const req = createMockReq({ user: createMockUser({ role: 'admin' }) });
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('用户角色不匹配：应返回403', () => {
      const middleware = requireRole(['super_admin']);
      const req = createMockReq({ user: createMockUser({ role: 'user' }) });
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    test('单角色字符串（非数组）：应正常工作', () => {
      const middleware = requireRole('admin');
      const req = createMockReq({ user: createMockUser({ role: 'admin' }) });
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('用户未认证（req.user为null）：应返回401', () => {
      const middleware = requireRole(['admin']);
      const req = createMockReq({});
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });

  // ---------- requirePermission() 测试 ----------
  describe('requirePermission() - 权限检查', () => {

    test('用户有对应权限：应调用next', async () => {
      const middleware = requirePermission('user.manage');
      const mockUser = createMockUser({
        getPermissions: jest.fn().mockResolvedValue(['user.manage'])
      });
      const req = createMockReq({ user: mockUser });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('用户无对应权限：应返回403', async () => {
      const middleware = requirePermission('system.manage');
      const mockUser = createMockUser({
        getPermissions: jest.fn().mockResolvedValue(['user.manage'])
      });
      const req = createMockReq({ user: mockUser });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    test('组权限映射：user.manage.group应可访问user.manage路由', async () => {
      const middleware = requirePermission('user.manage');
      const mockUser = createMockUser({
        getPermissions: jest.fn().mockResolvedValue(['user.manage.group'])
      });
      const req = createMockReq({ user: mockUser });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('通配符权限：admin.*应匹配admin.xxx', async () => {
      const middleware = requirePermission('admin.settings');
      const mockUser = createMockUser({
        getPermissions: jest.fn().mockResolvedValue(['admin.*'])
      });
      const req = createMockReq({ user: mockUser });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('用户未认证：应返回401', async () => {
      const middleware = requirePermission('user.manage');
      const req = createMockReq({});
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });
});
