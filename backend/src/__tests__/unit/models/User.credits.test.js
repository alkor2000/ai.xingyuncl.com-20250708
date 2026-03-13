/**
 * User模型 - 积分相关方法单元测试
 * 
 * 测试范围：
 * - getCredits()         获取可用余额（考虑过期）
 * - hasCredits()         检查余额是否充足
 * - isCreditsExpired()   检查积分是否过期
 * - getCreditsStats()    获取积分统计信息
 * - getCreditsRemainingDays()  获取剩余天数
 * - consumeCredits()     消费积分（含免费模型、过期、余额不足）
 * - addCredits()         充值积分
 * - deductCredits()      扣减积分
 * - setCreditsQuota()    设置积分配额
 * 
 * Mock策略：
 * - 数据库操作在测试文件内Mock，只测试业务逻辑
 * - User实例通过直接构造，不依赖findById
 */

// ========== 在require任何源码之前先Mock依赖 ==========
const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../../database/connection', () => ({
  query: mockQuery,
  simpleQuery: jest.fn(),
  transaction: mockTransaction,
  beginTransaction: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// 现在可以安全地require源码
const User = require('../../../models/User');

// ========== 辅助函数：创建测试用户实例 ==========

/**
 * 创建一个标准测试用户
 * @param {Object} overrides - 覆盖默认值的字段
 * @returns {User} 用户实例
 */
function createTestUser(overrides = {}) {
  return new User({
    id: 1,
    uuid: 'test-uuid-1234',
    email: 'test@example.com',
    username: 'testuser',
    role: 'user',
    group_id: 1,
    status: 'active',
    credits_quota: 1000,
    used_credits: 200,
    credits_expire_at: null,
    expire_at: null,
    deleted_at: null,
    ...overrides
  });
}

/**
 * 创建一个积分已过期的用户
 */
function createExpiredUser(overrides = {}) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  return createTestUser({
    credits_expire_at: yesterday,
    ...overrides
  });
}

/**
 * 创建一个积分即将过期的用户（3天后）
 */
function createExpiringUser(overrides = {}) {
  const threeDaysLater = new Date();
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);
  
  return createTestUser({
    credits_expire_at: threeDaysLater,
    ...overrides
  });
}

// ========== 测试套件 ==========

describe('User模型 - 积分管理', () => {

  // ---------- getCredits() 测试 ----------
  describe('getCredits() - 获取可用余额', () => {
    test('正常用户：配额1000已用200，余额应为800', () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      expect(user.getCredits()).toBe(800);
    });

    test('零余额用户：配额1000已用1000，余额应为0', () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 1000 });
      expect(user.getCredits()).toBe(0);
    });

    test('过度使用（边界情况）：已用超过配额，余额应为0而非负数', () => {
      const user = createTestUser({ credits_quota: 100, used_credits: 150 });
      expect(user.getCredits()).toBe(0);
    });

    test('积分已过期的用户：余额应为0', () => {
      const user = createExpiredUser({ credits_quota: 1000, used_credits: 200 });
      expect(user.getCredits()).toBe(0);
    });

    test('未设置配额的用户：默认值处理，余额应为0', () => {
      const user = createTestUser({ credits_quota: undefined, used_credits: undefined });
      expect(user.getCredits()).toBe(0);
    });

    test('配额为0的免费用户：余额应为0', () => {
      const user = createTestUser({ credits_quota: 0, used_credits: 0 });
      expect(user.getCredits()).toBe(0);
    });
  });

  // ---------- hasCredits() 测试 ----------
  describe('hasCredits() - 检查余额是否充足', () => {
    test('余额800，检查需要100：应返回true', () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      expect(user.hasCredits(100)).toBe(true);
    });

    test('余额800，检查需要800：刚好够应返回true', () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      expect(user.hasCredits(800)).toBe(true);
    });

    test('余额800，检查需要801：不够应返回false', () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      expect(user.hasCredits(801)).toBe(false);
    });

    test('余额0，检查需要1：应返回false', () => {
      const user = createTestUser({ credits_quota: 100, used_credits: 100 });
      expect(user.hasCredits(1)).toBe(false);
    });

    test('积分已过期，余额本应800但实际为0：应返回false', () => {
      const user = createExpiredUser({ credits_quota: 1000, used_credits: 200 });
      expect(user.hasCredits(1)).toBe(false);
    });

    test('默认参数amount=1：余额充足应返回true', () => {
      const user = createTestUser({ credits_quota: 100, used_credits: 0 });
      expect(user.hasCredits()).toBe(true);
    });
  });

  // ---------- isCreditsExpired() 测试 ----------
  describe('isCreditsExpired() - 检查积分是否过期', () => {
    test('未设置过期时间：应返回false（永不过期）', () => {
      const user = createTestUser({ credits_expire_at: null });
      expect(user.isCreditsExpired()).toBe(false);
    });

    test('过期时间是昨天：应返回true', () => {
      const user = createExpiredUser();
      expect(user.isCreditsExpired()).toBe(true);
    });

    test('过期时间是3天后：应返回false', () => {
      const user = createExpiringUser();
      expect(user.isCreditsExpired()).toBe(false);
    });

    test('过期时间是一年后：应返回false', () => {
      const oneYearLater = new Date();
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      const user = createTestUser({ credits_expire_at: oneYearLater });
      expect(user.isCreditsExpired()).toBe(false);
    });
  });

  // ---------- getCreditsRemainingDays() 测试 ----------
  describe('getCreditsRemainingDays() - 获取剩余天数', () => {
    test('未设置过期时间：应返回null', () => {
      const user = createTestUser({ credits_expire_at: null });
      expect(user.getCreditsRemainingDays()).toBeNull();
    });

    test('3天后过期：应返回约3天', () => {
      const user = createExpiringUser();
      const days = user.getCreditsRemainingDays();
      expect(days).toBeGreaterThanOrEqual(2);
      expect(days).toBeLessThanOrEqual(4);
    });

    test('已过期1天：应返回负数', () => {
      const user = createExpiredUser();
      const days = user.getCreditsRemainingDays();
      expect(days).toBeLessThanOrEqual(0);
    });
  });

  // ---------- getCreditsStats() 测试 ----------
  describe('getCreditsStats() - 获取积分统计', () => {
    test('正常用户统计信息完整', () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 300 });
      const stats = user.getCreditsStats();

      expect(stats.quota).toBe(1000);
      expect(stats.used).toBe(300);
      expect(stats.remaining).toBe(700);
      expect(stats.usageRate).toBe(30);
      expect(stats.isExpired).toBe(false);
    });

    test('过期用户：remaining应为0', () => {
      const user = createExpiredUser({ credits_quota: 1000, used_credits: 200 });
      const stats = user.getCreditsStats();

      expect(stats.remaining).toBe(0);
      expect(stats.isExpired).toBe(true);
    });

    test('零配额用户：usageRate应为0不能除零错误', () => {
      const user = createTestUser({ credits_quota: 0, used_credits: 0 });
      const stats = user.getCreditsStats();

      expect(stats.usageRate).toBe(0);
      expect(stats.remaining).toBe(0);
    });
  });

  // ---------- consumeCredits() 测试 ----------
  describe('consumeCredits() - 消费积分', () => {
    
    beforeEach(() => {
      // 模拟transaction：执行传入的回调函数
      mockTransaction.mockImplementation(async (callback) => {
        const queryFn = jest.fn();
        
        // UPDATE users 成功
        queryFn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });
        // SELECT balance 查询余额
        queryFn.mockResolvedValueOnce({ rows: [{ balance: 700 }] });
        // INSERT credit_transactions 记录流水
        queryFn.mockResolvedValueOnce({ rows: { insertId: 1 } });
        
        return await callback(queryFn);
      });
    });

    test('正常消费：扣减100积分应成功', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      const result = await user.consumeCredits(100, 1, 'conv-123', '对话消费');

      expect(result.success).toBe(true);
      expect(result.amount).toBe(100);
      expect(result.balanceAfter).toBe(700);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    test('免费模型：amount=0应成功且不扣积分', async () => {
      // 免费模型的transaction Mock
      mockTransaction.mockImplementation(async (callback) => {
        const queryFn = jest.fn();
        queryFn.mockResolvedValueOnce({ rows: [{ balance: 800 }] });
        queryFn.mockResolvedValueOnce({ rows: { insertId: 1 } });
        return await callback(queryFn);
      });

      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      const result = await user.consumeCredits(0, 1, 'conv-123', '免费模型');

      expect(result.success).toBe(true);
      expect(result.amount).toBe(0);
      expect(result.message).toContain('免费');
    });

    test('积分已过期：应抛出错误', async () => {
      const user = createExpiredUser({ credits_quota: 1000, used_credits: 200 });

      await expect(user.consumeCredits(100))
        .rejects.toThrow('积分已过期');
    });

    test('余额不足：应抛出错误', async () => {
      const user = createTestUser({ credits_quota: 100, used_credits: 90 });

      await expect(user.consumeCredits(50))
        .rejects.toThrow('积分余额不足');
    });

    test('负数消费：应抛出错误', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 0 });

      await expect(user.consumeCredits(-10))
        .rejects.toThrow('不能为负数');
    });
  });

  // ---------- addCredits() 测试 ----------
  describe('addCredits() - 充值积分', () => {

    beforeEach(() => {
      mockTransaction.mockImplementation(async (callback) => {
        const queryFn = jest.fn();
        queryFn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });
        queryFn.mockResolvedValueOnce({ rows: { insertId: 1 } });
        return await callback(queryFn);
      });
    });

    test('正常充值：增加500积分应成功', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      const result = await user.addCredits(500, '管理员充值', 99);

      expect(result.success).toBe(true);
      expect(result.amount).toBe(500);
      expect(result.oldQuota).toBe(1000);
      expect(result.newQuota).toBe(1500);
      expect(result.balanceAfter).toBe(1300);
      expect(user.credits_quota).toBe(1500);
    });

    test('充值金额为0：应抛出验证错误', async () => {
      const user = createTestUser();

      await expect(user.addCredits(0, '测试'))
        .rejects.toThrow('充值金额必须大于0');
    });

    test('充值金额为负数：应抛出验证错误', async () => {
      const user = createTestUser();

      await expect(user.addCredits(-100, '测试'))
        .rejects.toThrow('充值金额必须大于0');
    });
  });

  // ---------- deductCredits() 测试 ----------
  describe('deductCredits() - 扣减积分', () => {

    beforeEach(() => {
      mockTransaction.mockImplementation(async (callback) => {
        const queryFn = jest.fn();
        queryFn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });
        queryFn.mockResolvedValueOnce({ rows: { insertId: 1 } });
        return await callback(queryFn);
      });
    });

    test('正常扣减：从1000扣减300应成功', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      const result = await user.deductCredits(300, '管理员扣减', 99);

      expect(result.success).toBe(true);
      expect(result.oldQuota).toBe(1000);
      expect(result.newQuota).toBe(700);
      expect(user.credits_quota).toBe(700);
    });

    test('扣减超过配额：配额应降为0而非负数', async () => {
      const user = createTestUser({ credits_quota: 100, used_credits: 50 });
      const result = await user.deductCredits(200, '全部扣减', 99);

      expect(result.newQuota).toBe(0);
      expect(user.credits_quota).toBe(0);
    });

    test('扣减金额为0：应抛出验证错误', async () => {
      const user = createTestUser();

      await expect(user.deductCredits(0, '测试'))
        .rejects.toThrow('扣减金额必须大于0');
    });
  });

  // ---------- setCreditsQuota() 测试 ----------
  describe('setCreditsQuota() - 设置积分配额', () => {

    beforeEach(() => {
      mockTransaction.mockImplementation(async (callback) => {
        const queryFn = jest.fn();
        queryFn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });
        queryFn.mockResolvedValueOnce({ rows: { insertId: 1 } });
        return await callback(queryFn);
      });
    });

    test('设置新配额：从1000改为2000应成功', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      const result = await user.setCreditsQuota(2000, '调整配额', 99);

      expect(result.success).toBe(true);
      expect(result.oldQuota).toBe(1000);
      expect(result.newQuota).toBe(2000);
      expect(user.credits_quota).toBe(2000);
    });

    test('降低配额到已使用量以下：used_credits应被截断', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 800 });
      const result = await user.setCreditsQuota(500, '降低配额', 99);

      expect(result.newQuota).toBe(500);
      expect(user.used_credits).toBe(500);
    });

    test('设置为0：应成功', async () => {
      const user = createTestUser({ credits_quota: 1000, used_credits: 200 });
      const result = await user.setCreditsQuota(0, '清零', 99);

      expect(result.newQuota).toBe(0);
    });

    test('设置为负数：应抛出验证错误', async () => {
      const user = createTestUser();

      await expect(user.setCreditsQuota(-100, '测试'))
        .rejects.toThrow('积分配额不能为负数');
    });
  });
});
