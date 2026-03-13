/**
 * 登录流程集成测试
 */

const request = require('supertest');
const app = require('../../../app');
const dbConnection = require('../../../database/connection');
const User = require('../../../models/User');
const bcrypt = require('bcryptjs');

describe('Auth Integration - Login', () => {
  let testUser;

  beforeAll(async () => {
    // 创建测试用户
    const hashedPassword = await bcrypt.hash('Test123456!', 10);
    testUser = {
      email: 'integration.test@example.com',
      username: 'integrationtest',
      password: hashedPassword,
      role: 'user',
      status: 'active'
    };

    // 清理可能存在的测试数据
    await dbConnection.query(
      'DELETE FROM users WHERE email = ?',
      [testUser.email]
    );

    // 插入测试用户
    await dbConnection.query(
      'INSERT INTO users (email, username, password, role, status) VALUES (?, ?, ?, ?, ?)',
      [testUser.email, testUser.username, testUser.password, testUser.role, testUser.status]
    );
  });

  afterAll(async () => {
    // 清理测试数据
    await dbConnection.query(
      'DELETE FROM users WHERE email = ?',
      [testUser.email]
    );
    
    // 关闭数据库连接
    if (dbConnection && dbConnection.close) {
      await dbConnection.close();
    }
  });

  describe('POST /api/auth/login', () => {
    it('应该成功登录并返回token', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'Test123456!'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('refreshToken');
    });

    it('应该拒绝错误的密码', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('密码错误');
    });

    it('应该拒绝不存在的用户', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Test123456!'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('应该验证请求参数', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken;

    beforeEach(async () => {
      // 先登录获取token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'Test123456!'
        });
      
      authToken = loginResponse.body.data.tokens.accessToken;
    });

    it('应该返回当前用户信息', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe(testUser.email);
    });

    it('应该拒绝未认证的请求', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
