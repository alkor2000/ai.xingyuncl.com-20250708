/**
 * 测试辅助函数
 */

const jwt = require('jsonwebtoken');

/**
 * 生成测试用的JWT token
 */
const generateTestToken = (userId, role = 'user') => {
  const payload = {
    userId,
    email: `test${userId}@example.com`,
    role,
    type: 'access',
    jti: `test-${Date.now()}`
  };
  
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '1h'
  });
};

/**
 * 创建测试用户数据
 */
const createTestUser = (overrides = {}) => {
  const timestamp = Date.now();
  return {
    email: `test${timestamp}@example.com`,
    username: `testuser${timestamp}`,
    password: 'Test123456!',
    role: 'user',
    status: 'active',
    ...overrides
  };
};

/**
 * 模拟请求对象
 */
const mockRequest = (data = {}) => {
  return {
    body: data.body || {},
    params: data.params || {},
    query: data.query || {},
    headers: data.headers || {},
    user: data.user || null,
    header: function(name) {
      return this.headers[name];
    }
  };
};

/**
 * 模拟响应对象
 */
const mockResponse = () => {
  const res = {
    statusCode: 200,
    data: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.data = data;
      return this;
    },
    send: function(data) {
      this.data = data;
      return this;
    }
  };
  return res;
};

module.exports = {
  generateTestToken,
  createTestUser,
  mockRequest,
  mockResponse
};
