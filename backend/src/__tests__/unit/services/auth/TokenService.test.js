/**
 * TokenService - JWT令牌服务单元测试
 * 
 * 测试范围：
 * - _generateJti()          生成唯一JWT ID
 * - generateTokenPair()     生成access/refresh双Token
 * - refreshAccessToken()    刷新访问令牌
 * - blacklistToken()        Token加入黑名单
 * - getRefreshTokenExpiry() 获取动态过期时间
 * 
 * Mock策略：
 * - Mock数据库连接、Redis、日志、SystemConfig
 * - jwt库使用真实实现（验证签名正确性）
 * - crypto库使用真实实现（验证随机性）
 */

// ========== Mock外部依赖（必须在require之前） ==========

jest.mock('../../../../models/SystemConfig', () => ({
  getLoginSettings: jest.fn()
}));

jest.mock('../../../../config', () => ({
  auth: {
    jwt: {
      accessSecret: 'test-access-secret-key-for-unit-testing-32chars!',
      refreshSecret: 'test-refresh-secret-key-for-unit-testing-32chars!',
      accessExpiresIn: '15m',
      refreshExpiresIn: '14d',
      issuer: 'ai-platform-test',
      audience: 'ai-platform-users-test'
    }
  }
}));

jest.mock('../../../../database/redis', () => ({
  isConnected: true,
  exists: jest.fn(),
  set: jest.fn()
}));

jest.mock('../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块和依赖 ==========
const jwt = require('jsonwebtoken');
const TokenService = require('../../../../services/auth/TokenService');
const SystemConfig = require('../../../../models/SystemConfig');
const redisConnection = require('../../../../database/redis');
const config = require('../../../../config');

// ========== 辅助函数 ==========

/**
 * 创建模拟用户对象
 */
function createMockUser(overrides = {}) {
  return {
    id: 1,
    email: 'test@example.com',
    username: 'testuser',
    role: 'user',
    uuid: 'test-uuid-1234',
    ...overrides
  };
}

// ========== 测试套件 ==========

describe('TokenService - JWT令牌服务', () => {

  // ---------- _generateJti() 测试 ----------
  describe('_generateJti() - 生成唯一JWT ID', () => {
    test('应包含用户ID前缀', () => {
      const jti = TokenService._generateJti(42);
      expect(jti).toMatch(/^42-/);
    });

    test('应包含时间戳部分', () => {
      const before = Date.now();
      const jti = TokenService._generateJti(1);
      const after = Date.now();

      // 提取时间戳部分（第二段）
      const parts = jti.split('-');
      const timestamp = parseInt(parts[1]);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    test('应包含32位十六进制随机部分（16字节）', () => {
      const jti = TokenService._generateJti(1);
      // 格式：{userId}-{timestamp}-{32位hex}
      const parts = jti.split('-');
      const randomPart = parts[2];
      expect(randomPart).toMatch(/^[0-9a-f]{32}$/);
    });

    test('两次生成的jti应不同', () => {
      const jti1 = TokenService._generateJti(1);
      const jti2 = TokenService._generateJti(1);
      expect(jti1).not.toBe(jti2);
    });
  });

  // ---------- generateTokenPair() 测试 ----------
  describe('generateTokenPair() - 生成双Token', () => {
    beforeEach(() => {
      // 默认返回14天
      SystemConfig.getLoginSettings.mockResolvedValue({
        refresh_token_days: 14
      });
    });

    test('应返回accessToken、refreshToken和expiresIn', async () => {
      const user = createMockUser();
      const result = await TokenService.generateTokenPair(user);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn', '15m');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    test('accessToken应包含正确的payload', async () => {
      const user = createMockUser({ id: 5, role: 'admin' });
      const result = await TokenService.generateTokenPair(user);

      const decoded = jwt.verify(result.accessToken, config.auth.jwt.accessSecret);
      expect(decoded.userId).toBe(5);
      expect(decoded.role).toBe('admin');
      expect(decoded.type).toBe('access');
      expect(decoded.jti).toBeDefined();
      expect(decoded.email).toBe('test@example.com');
    });

    test('refreshToken应包含type=refresh和关联的jti', async () => {
      const user = createMockUser();
      const result = await TokenService.generateTokenPair(user);

      const decoded = jwt.verify(result.refreshToken, config.auth.jwt.refreshSecret);
      expect(decoded.userId).toBe(1);
      expect(decoded.type).toBe('refresh');
      expect(decoded.jti).toMatch(/^refresh-/);
    });

    test('SSO用户：accessToken应包含ssoUser和uuid', async () => {
      const user = createMockUser({ uuid: 'sso-uuid-5678' });
      const result = await TokenService.generateTokenPair(user, true);

      const decoded = jwt.verify(result.accessToken, config.auth.jwt.accessSecret);
      expect(decoded.ssoUser).toBe(true);
      expect(decoded.uuid).toBe('sso-uuid-5678');
    });

    test('非SSO用户：accessToken不应包含ssoUser', async () => {
      const user = createMockUser();
      const result = await TokenService.generateTokenPair(user, false);

      const decoded = jwt.verify(result.accessToken, config.auth.jwt.accessSecret);
      expect(decoded.ssoUser).toBeUndefined();
    });

    test('refreshToken过期时间应从数据库读取', async () => {
      SystemConfig.getLoginSettings.mockResolvedValue({
        refresh_token_days: 30
      });

      const user = createMockUser();
      const result = await TokenService.generateTokenPair(user);

      const decoded = jwt.verify(result.refreshToken, config.auth.jwt.refreshSecret);
      // 30天 = 2592000秒，允许几秒误差
      const expectedExp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      expect(decoded.exp).toBeGreaterThan(expectedExp - 10);
      expect(decoded.exp).toBeLessThan(expectedExp + 10);
    });
  });

  // ---------- refreshAccessToken() 测试 ----------
  describe('refreshAccessToken() - 刷新访问令牌', () => {
    test('有效的refreshToken：应返回userId', async () => {
      // 先生成一对合法Token
      SystemConfig.getLoginSettings.mockResolvedValue({ refresh_token_days: 14 });
      redisConnection.exists.mockResolvedValue(false);

      const user = createMockUser({ id: 7 });
      const { refreshToken } = await TokenService.generateTokenPair(user);

      const userId = await TokenService.refreshAccessToken(refreshToken);
      expect(userId).toBe(7);
    });

    test('空的refreshToken：应抛出错误', async () => {
      await expect(TokenService.refreshAccessToken(null))
        .rejects.toThrow('刷新令牌不能为空');

      await expect(TokenService.refreshAccessToken(''))
        .rejects.toThrow('刷新令牌不能为空');
    });

    test('使用accessToken代替refreshToken：应抛出错误', async () => {
      SystemConfig.getLoginSettings.mockResolvedValue({ refresh_token_days: 14 });

      const user = createMockUser();
      const { accessToken } = await TokenService.generateTokenPair(user);

      // accessToken的type是'access'，不是'refresh'，应被拒绝
      // 注意：accessToken用refreshSecret验证会失败
      await expect(TokenService.refreshAccessToken(accessToken))
        .rejects.toThrow();
    });

    test('已加入黑名单的refreshToken：应抛出错误', async () => {
      SystemConfig.getLoginSettings.mockResolvedValue({ refresh_token_days: 14 });
      redisConnection.exists.mockResolvedValue(true); // 模拟在黑名单中

      const user = createMockUser();
      const { refreshToken } = await TokenService.generateTokenPair(user);

      await expect(TokenService.refreshAccessToken(refreshToken))
        .rejects.toThrow('刷新令牌已失效');
    });

    test('过期的refreshToken：应抛出错误', async () => {
      // 手动创建一个已过期的token
      const expiredToken = jwt.sign(
        { userId: 1, type: 'refresh', jti: 'expired-jti' },
        config.auth.jwt.refreshSecret,
        { expiresIn: '0s' } // 立即过期
      );

      // 等一下确保过期
      await new Promise(resolve => setTimeout(resolve, 100));

      await expect(TokenService.refreshAccessToken(expiredToken))
        .rejects.toThrow();
    });
  });

  // ---------- blacklistToken() 测试 ----------
  describe('blacklistToken() - Token加入黑名单', () => {
    test('有效Token：应成功加入黑名单', async () => {
      SystemConfig.getLoginSettings.mockResolvedValue({ refresh_token_days: 14 });
      redisConnection.set.mockResolvedValue('OK');

      const user = createMockUser();
      const { accessToken } = await TokenService.generateTokenPair(user);

      const result = await TokenService.blacklistToken(accessToken, 1);
      expect(result).toBe(true);
      expect(redisConnection.set).toHaveBeenCalledWith(
        expect.stringContaining('token_blacklist:'),
        1,
        expect.any(Number)
      );
    });

    test('空Token：应返回false', async () => {
      const result = await TokenService.blacklistToken(null, 1);
      expect(result).toBe(false);
    });

    test('Redis不可用：应返回false', async () => {
      // 临时设置Redis不可用
      const originalConnected = redisConnection.isConnected;
      redisConnection.isConnected = false;

      const result = await TokenService.blacklistToken('some-token', 1);
      expect(result).toBe(false);

      // 恢复
      redisConnection.isConnected = originalConnected;
    });
  });

  // ---------- getRefreshTokenExpiry() 测试 ----------
  describe('getRefreshTokenExpiry() - 获取动态过期时间', () => {
    test('数据库配置30天：应返回30d', async () => {
      SystemConfig.getLoginSettings.mockResolvedValue({
        refresh_token_days: 30
      });

      const expiry = await TokenService.getRefreshTokenExpiry();
      expect(expiry).toBe('30d');
    });

    test('数据库未配置：应使用默认14天', async () => {
      SystemConfig.getLoginSettings.mockResolvedValue({});

      const expiry = await TokenService.getRefreshTokenExpiry();
      expect(expiry).toBe('14d');
    });

    test('数据库查询失败：应降级使用config默认值', async () => {
      SystemConfig.getLoginSettings.mockRejectedValue(new Error('DB连接失败'));

      const expiry = await TokenService.getRefreshTokenExpiry();
      expect(expiry).toBe(config.auth.jwt.refreshExpiresIn);
    });
  });
});
