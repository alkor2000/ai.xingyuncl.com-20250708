/**
 * CreditsService - 积分服务层单元测试
 * 
 * 测试范围：
 * - setUserCredits()      设置积分配额（含参数验证）
 * - addUserCredits()      充值积分（含参数验证）
 * - deductUserCredits()   扣减积分（含参数验证）
 * - consumeCredits()      消费积分（含过期检查、余额检查）
 * - extendCreditsExpireDate()  延长有效期（含参数验证）
 * - batchAddCredits()     批量充值
 * - getUserCreditsHistory()  获取积分历史
 * 
 * Mock策略：
 * - 在测试文件内Mock所有外部依赖
 * - User.findById返回Mock用户对象
 * - 本层只测Service的参数验证、用户查找、错误处理
 */

// ========== Mock所有外部依赖 ==========
jest.mock('../../../database/connection', () => ({
  query: jest.fn(),
  simpleQuery: jest.fn(),
  transaction: jest.fn(),
  beginTransaction: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock User模型（拦截findById和getCreditHistory）
jest.mock('../../../models/User');

const CreditsService = require('../../../services/admin/CreditsService');
const User = require('../../../models/User');
const dbConnection = require('../../../database/connection');

// ========== 辅助函数 ==========

/**
 * 创建Mock用户对象（模拟User实例的方法）
 */
function createMockUser(overrides = {}) {
  const defaultData = {
    id: 1,
    credits_quota: 1000,
    used_credits: 200,
    credits_expire_at: null,
    ...overrides
  };

  return {
    ...defaultData,
    setCreditsQuota: jest.fn().mockResolvedValue({
      success: true,
      oldQuota: defaultData.credits_quota,
      newQuota: 2000,
      balanceAfter: 1800
    }),
    addCredits: jest.fn().mockResolvedValue({
      success: true,
      amount: 500,
      oldQuota: defaultData.credits_quota,
      newQuota: 1500,
      balanceAfter: 1300
    }),
    deductCredits: jest.fn().mockResolvedValue({
      success: true,
      amount: 300,
      oldQuota: defaultData.credits_quota,
      newQuota: 700,
      balanceAfter: 500
    }),
    consumeCredits: jest.fn().mockResolvedValue({
      success: true,
      amount: 100,
      balanceAfter: 700
    }),
    setCreditsExpireDate: jest.fn().mockResolvedValue({
      success: true,
      expireDate: new Date('2027-01-01'),
      remainingDays: 365
    }),
    extendCreditsExpireDate: jest.fn().mockResolvedValue({
      success: true,
      expireDate: new Date('2027-01-01'),
      remainingDays: 365
    }),
    hasCredits: jest.fn().mockReturnValue(true),
    getCredits: jest.fn().mockReturnValue(800),
    isCreditsExpired: jest.fn().mockReturnValue(false),
    getCreditsRemainingDays: jest.fn().mockReturnValue(365)
  };
}

// ========== 测试套件 ==========

describe('CreditsService - 积分服务层', () => {

  // ---------- setUserCredits 测试 ----------
  describe('setUserCredits() - 设置积分配额', () => {
    test('正常设置：应成功调用user.setCreditsQuota', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);

      const result = await CreditsService.setUserCredits(1, 2000, {
        reason: '测试设置',
        operatorId: 99
      });

      expect(result.success).toBe(true);
      expect(mockUser.setCreditsQuota).toHaveBeenCalledWith(2000, '测试设置', 99);
    });

    test('配额为非数字：应抛出ValidationError', async () => {
      await expect(CreditsService.setUserCredits(1, '不是数字'))
        .rejects.toThrow('积分配额必须是非负数字');
    });

    test('配额为负数：应抛出ValidationError', async () => {
      await expect(CreditsService.setUserCredits(1, -100))
        .rejects.toThrow('积分配额必须是非负数字');
    });

    test('用户不存在：应抛出ValidationError', async () => {
      User.findById.mockResolvedValue(null);

      await expect(CreditsService.setUserCredits(999, 1000))
        .rejects.toThrow('用户不存在');
    });
  });

  // ---------- addUserCredits 测试 ----------
  describe('addUserCredits() - 充值积分', () => {
    test('正常充值500：应成功', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);

      const result = await CreditsService.addUserCredits(1, 500, {
        reason: '测试充值',
        operatorId: 99
      });

      expect(result.success).toBe(true);
      expect(mockUser.addCredits).toHaveBeenCalledWith(500, '测试充值', 99, null);
    });

    test('充值金额为0：应抛出ValidationError', async () => {
      await expect(CreditsService.addUserCredits(1, 0))
        .rejects.toThrow('充值金额必须是正数');
    });

    test('充值金额为负数：应抛出ValidationError', async () => {
      await expect(CreditsService.addUserCredits(1, -100))
        .rejects.toThrow('充值金额必须是正数');
    });

    test('充值金额非数字：应抛出ValidationError', async () => {
      await expect(CreditsService.addUserCredits(1, '一百'))
        .rejects.toThrow('充值金额必须是正数');
    });

    test('用户不存在：应抛出ValidationError', async () => {
      User.findById.mockResolvedValue(null);

      await expect(CreditsService.addUserCredits(999, 500))
        .rejects.toThrow('用户不存在');
    });

    test('带延长天数：应传递extendDays参数', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);

      await CreditsService.addUserCredits(1, 500, {
        reason: '充值+延期',
        operatorId: 99,
        extendDays: 30
      });

      expect(mockUser.addCredits).toHaveBeenCalledWith(500, '充值+延期', 99, 30);
    });
  });

  // ---------- deductUserCredits 测试 ----------
  describe('deductUserCredits() - 扣减积分', () => {
    test('正常扣减300：应成功', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);

      const result = await CreditsService.deductUserCredits(1, 300, {
        reason: '测试扣减',
        operatorId: 99
      });

      expect(result.success).toBe(true);
      expect(mockUser.deductCredits).toHaveBeenCalledWith(300, '测试扣减', 99);
    });

    test('扣减金额为0：应抛出ValidationError', async () => {
      await expect(CreditsService.deductUserCredits(1, 0))
        .rejects.toThrow('扣减金额必须是正数');
    });

    test('扣减金额为负数：应抛出ValidationError', async () => {
      await expect(CreditsService.deductUserCredits(1, -50))
        .rejects.toThrow('扣减金额必须是正数');
    });
  });

  // ---------- consumeCredits 测试 ----------
  describe('consumeCredits() - 消费积分', () => {
    test('正常消费100：应成功', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);

      const result = await CreditsService.consumeCredits(1, 100, {
        modelId: 5,
        conversationId: 'conv-abc',
        reason: '对话消费'
      });

      expect(result.success).toBe(true);
      expect(mockUser.consumeCredits).toHaveBeenCalledWith(
        100, 5, 'conv-abc', '对话消费'
      );
    });

    test('用户不存在：应抛出ValidationError', async () => {
      User.findById.mockResolvedValue(null);

      await expect(CreditsService.consumeCredits(999, 100))
        .rejects.toThrow('用户不存在');
    });

    test('积分已过期：应抛出ValidationError', async () => {
      const mockUser = createMockUser();
      mockUser.isCreditsExpired.mockReturnValue(true);
      mockUser.getCreditsRemainingDays.mockReturnValue(-1);
      User.findById.mockResolvedValue(mockUser);

      await expect(CreditsService.consumeCredits(1, 100))
        .rejects.toThrow('积分已过期');
    });

    test('余额不足：应抛出ValidationError', async () => {
      const mockUser = createMockUser();
      mockUser.hasCredits.mockReturnValue(false);
      mockUser.getCredits.mockReturnValue(50);
      User.findById.mockResolvedValue(mockUser);

      await expect(CreditsService.consumeCredits(1, 100))
        .rejects.toThrow('积分余额不足');
    });
  });

  // ---------- extendCreditsExpireDate 测试 ----------
  describe('extendCreditsExpireDate() - 延长有效期', () => {
    test('延长30天：应成功', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);

      const result = await CreditsService.extendCreditsExpireDate(1, 30, {
        reason: '测试延期',
        operatorId: 99
      });

      expect(result.success).toBe(true);
      expect(mockUser.extendCreditsExpireDate).toHaveBeenCalledWith(30, '测试延期', 99);
    });

    test('天数为0：应抛出ValidationError', async () => {
      await expect(CreditsService.extendCreditsExpireDate(1, 0))
        .rejects.toThrow('延长天数必须是正数');
    });

    test('天数为负数：应抛出ValidationError', async () => {
      await expect(CreditsService.extendCreditsExpireDate(1, -10))
        .rejects.toThrow('延长天数必须是正数');
    });

    test('天数非数字：应抛出ValidationError', async () => {
      await expect(CreditsService.extendCreditsExpireDate(1, '三十'))
        .rejects.toThrow('延长天数必须是正数');
    });
  });

  // ---------- getUserCreditsHistory 测试 ----------
  describe('getUserCreditsHistory() - 获取积分历史', () => {
    test('正常获取：应返回分页数据', async () => {
      const mockUser = createMockUser();
      User.findById.mockResolvedValue(mockUser);
      User.getCreditHistory = jest.fn().mockResolvedValue({
        history: [{ id: 1, amount: -100, transaction_type: 'chat_consume' }],
        pagination: { page: 1, limit: 20, total: 1 }
      });

      const result = await CreditsService.getUserCreditsHistory(1, {
        page: 1,
        limit: 20
      });

      expect(result.history).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    test('用户不存在：应抛出ValidationError', async () => {
      User.findById.mockResolvedValue(null);

      await expect(CreditsService.getUserCreditsHistory(999))
        .rejects.toThrow('用户不存在');
    });
  });

  // ---------- batchAddCredits 测试 ----------
  describe('batchAddCredits() - 批量充值', () => {
    test('空用户列表：应抛出ValidationError', async () => {
      await expect(CreditsService.batchAddCredits([], 500))
        .rejects.toThrow('用户ID列表不能为空');
    });

    test('金额为0：应抛出ValidationError', async () => {
      await expect(CreditsService.batchAddCredits([1], 0))
        .rejects.toThrow('充值金额必须是正数');
    });

    test('金额为负数：应抛出ValidationError', async () => {
      await expect(CreditsService.batchAddCredits([1, 2], -100))
        .rejects.toThrow('充值金额必须是正数');
    });

    test('非数组用户列表：应抛出ValidationError', async () => {
      await expect(CreditsService.batchAddCredits('not-array', 500))
        .rejects.toThrow('用户ID列表不能为空');
    });
  });
});
