/**
 * UserService - 用户管理服务单元测试
 * 
 * 测试范围：
 * - validateUserData()           用户数据验证（邮箱非必填、用户名格式、密码强度）
 * - generateRandomPassword()     密码学安全随机密码生成
 * - generateUUID()               UUID生成
 * - createUser()                 创建用户（系统默认值、唯一性检查、组容量）
 * - deleteUser()                 软删除用户
 * - resetPassword()              重置密码（长度验证）
 * - batchUpdateStatus()          批量更新状态（参数验证）
 * - batchCreateUsers()           批量创建（参数验证、积分池、容量、用户名冲突）
 * 
 * Mock策略：
 * - User模型、GroupService、SystemConfig、dbConnection全Mock
 * - 只测Service层业务逻辑和验证规则
 */

// ========== Mock外部依赖 ==========

jest.mock('../../../../models/User', () => ({
  findByEmail: jest.fn(),
  findByUsername: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  getList: jest.fn(),
  createGroup: jest.fn()
}));

jest.mock('../../../../models/AIModel', () => ({
  getUserAvailableModels: jest.fn(),
  getAvailableModelsByGroup: jest.fn(),
  getUserModelRestrictions: jest.fn(),
  updateUserModelRestrictions: jest.fn()
}));

jest.mock('../../../../models/SystemConfig', () => ({
  getFormattedSettings: jest.fn()
}));

jest.mock('../../../../services/admin/GroupService', () => ({
  checkGroupCapacity: jest.fn(),
  findGroupById: jest.fn(),
  getGroupUserCount: jest.fn()
}));

const mockQuery = jest.fn();
const mockTransaction = jest.fn();
jest.mock('../../../../database/connection', () => ({
  query: mockQuery,
  simpleQuery: jest.fn(),
  transaction: mockTransaction
}));

jest.mock('../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块 ==========
const UserService = require('../../../../services/admin/UserService');
const User = require('../../../../models/User');
const SystemConfig = require('../../../../models/SystemConfig');
const GroupService = require('../../../../services/admin/GroupService');

// ========== 测试套件 ==========

describe('UserService - 用户管理服务', () => {

  // ========== validateUserData() 测试 ==========
  describe('validateUserData() - 用户数据验证', () => {

    test('合法数据：应通过验证', async () => {
      const result = await UserService.validateUserData({
        email: 'test@example.com',
        username: 'testuser',
        password: '123456'
      });
      expect(result).toBe(true);
    });

    test('邮箱非必填：不填邮箱应通过', async () => {
      const result = await UserService.validateUserData({
        email: null,
        username: 'testuser',
        password: '123456'
      });
      expect(result).toBe(true);
    });

    test('邮箱为空字符串：应通过（falsy视为未填）', async () => {
      const result = await UserService.validateUserData({
        email: '',
        username: 'testuser',
        password: '123456'
      });
      expect(result).toBe(true);
    });

    test('邮箱格式错误：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: 'not-an-email',
        username: 'testuser',
        password: '123456'
      })).rejects.toThrow('数据验证失败');
    });

    test('用户名为空：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: null,
        username: '',
        password: '123456'
      })).rejects.toThrow('数据验证失败');
    });

    test('用户名含特殊字符：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: null,
        username: 'test@user!',
        password: '123456'
      })).rejects.toThrow('数据验证失败');
    });

    test('用户名太短（2位）：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: null,
        username: 'ab',
        password: '123456'
      })).rejects.toThrow('数据验证失败');
    });

    test('用户名太长（21位）：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: null,
        username: 'a'.repeat(21),
        password: '123456'
      })).rejects.toThrow('数据验证失败');
    });

    test('用户名3-20位字母数字下划线横线：应通过', async () => {
      const result = await UserService.validateUserData({
        email: null,
        username: 'test_user-01',
        password: '123456'
      });
      expect(result).toBe(true);
    });

    test('密码为空：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: null,
        username: 'testuser',
        password: ''
      })).rejects.toThrow('数据验证失败');
    });

    test('密码太短（5位）：应抛出验证错误', async () => {
      await expect(UserService.validateUserData({
        email: null,
        username: 'testuser',
        password: '12345'
      })).rejects.toThrow('数据验证失败');
    });

    test('密码刚好6位：应通过', async () => {
      const result = await UserService.validateUserData({
        email: null,
        username: 'testuser',
        password: '123456'
      });
      expect(result).toBe(true);
    });

    test('多个错误同时存在：errors数组应包含所有错误', async () => {
      try {
        await UserService.validateUserData({
          email: 'bad-email',
          username: '',
          password: '123'
        });
        fail('应抛出错误');
      } catch (error) {
        expect(error.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // ========== generateRandomPassword() 测试 ==========
  describe('generateRandomPassword() - 随机密码生成', () => {

    test('默认8位长度', () => {
      const password = UserService.generateRandomPassword();
      expect(password.length).toBe(8);
    });

    test('自定义长度12位', () => {
      const password = UserService.generateRandomPassword(12);
      expect(password.length).toBe(12);
    });

    test('不含易混淆字符（0/O/1/l/I）', () => {
      // 生成多次确保覆盖
      for (let i = 0; i < 50; i++) {
        const password = UserService.generateRandomPassword(20);
        expect(password).not.toMatch(/[0O1lI]/);
      }
    });

    test('两次生成应不同（密码学随机）', () => {
      const p1 = UserService.generateRandomPassword(16);
      const p2 = UserService.generateRandomPassword(16);
      expect(p1).not.toBe(p2);
    });

    test('只含允许的字符集', () => {
      const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/;
      for (let i = 0; i < 20; i++) {
        const password = UserService.generateRandomPassword(20);
        expect(password).toMatch(allowed);
      }
    });
  });

  // ========== generateUUID() 测试 ==========
  describe('generateUUID() - UUID生成', () => {

    test('应返回合法的UUID v4格式', () => {
      const uuid = UserService.generateUUID();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });

    test('两次生成应不同', () => {
      const u1 = UserService.generateUUID();
      const u2 = UserService.generateUUID();
      expect(u1).not.toBe(u2);
    });
  });

  // ========== createUser() 测试 ==========
  describe('createUser() - 创建用户', () => {

    beforeEach(() => {
      SystemConfig.getFormattedSettings.mockResolvedValue({
        user: { default_tokens: 5000, default_credits: 500, default_group_id: 1 }
      });
      User.findByEmail.mockResolvedValue(null);
      User.findByUsername.mockResolvedValue(null);
      GroupService.checkGroupCapacity.mockResolvedValue(true);
      User.create.mockResolvedValue({
        id: 1, username: 'newuser', email: 'new@test.com', role: 'user',
        group_id: 1, token_quota: 5000, credits_quota: 500
      });
    });

    test('正常创建：应返回新用户', async () => {
      const result = await UserService.createUser({
        username: 'newuser',
        email: 'new@test.com',
        password: '123456'
      });

      expect(result.id).toBe(1);
      expect(User.create).toHaveBeenCalled();
    });

    test('邮箱已存在：应抛出ConflictError', async () => {
      User.findByEmail.mockResolvedValue({ id: 99, email: 'exist@test.com' });

      await expect(UserService.createUser({
        username: 'newuser',
        email: 'exist@test.com',
        password: '123456'
      })).rejects.toThrow('该邮箱已被注册');
    });

    test('用户名已存在：应抛出ConflictError', async () => {
      User.findByUsername.mockResolvedValue({ id: 88, username: 'taken' });

      await expect(UserService.createUser({
        username: 'taken',
        password: '123456'
      })).rejects.toThrow('该用户名已被使用');
    });

    test('组已满员：应抛出ValidationError', async () => {
      GroupService.checkGroupCapacity.mockResolvedValue(false);
      GroupService.findGroupById.mockResolvedValue({ user_limit: 10 });
      GroupService.getGroupUserCount.mockResolvedValue(10);

      await expect(UserService.createUser({
        username: 'newuser',
        password: '123456'
      })).rejects.toThrow('已满员');
    });

    test('系统配置获取失败：应降级使用内置默认值', async () => {
      SystemConfig.getFormattedSettings.mockRejectedValue(new Error('DB down'));

      const result = await UserService.createUser({
        username: 'fallback',
        password: '123456'
      });

      // 应该还是能创建成功（用内置默认值）
      expect(User.create).toHaveBeenCalled();
    });
  });

  // ========== deleteUser() 测试 ==========
  describe('deleteUser() - 软删除用户', () => {

    test('正常删除：应调用softDelete并返回成功', async () => {
      const mockUser = {
        id: 1, email: 'del@test.com', username: 'deluser',
        softDelete: jest.fn().mockResolvedValue(true)
      };
      User.findById.mockResolvedValue(mockUser);

      const result = await UserService.deleteUser(1, 99);

      expect(result.success).toBe(true);
      expect(mockUser.softDelete).toHaveBeenCalled();
    });

    test('用户不存在：应抛出ValidationError', async () => {
      User.findById.mockResolvedValue(null);

      await expect(UserService.deleteUser(999))
        .rejects.toThrow('用户不存在');
    });
  });

  // ========== resetPassword() 测试 ==========
  describe('resetPassword() - 重置密码', () => {

    test('正常重置：应成功', async () => {
      const mockUser = {
        id: 1, email: 'user@test.com',
        update: jest.fn().mockResolvedValue(true)
      };
      User.findById.mockResolvedValue(mockUser);

      const result = await UserService.resetPassword(1, 'newpass123');

      expect(result.success).toBe(true);
      expect(mockUser.update).toHaveBeenCalledWith({ password: 'newpass123' });
    });

    test('用户不存在：应抛出错误', async () => {
      User.findById.mockResolvedValue(null);

      await expect(UserService.resetPassword(999, '123456'))
        .rejects.toThrow('用户不存在');
    });

    test('密码太短：应抛出错误', async () => {
      User.findById.mockResolvedValue({ id: 1 });

      await expect(UserService.resetPassword(1, '12345'))
        .rejects.toThrow('密码长度至少6个字符');
    });

    test('密码为空：应抛出错误', async () => {
      User.findById.mockResolvedValue({ id: 1 });

      await expect(UserService.resetPassword(1, ''))
        .rejects.toThrow('密码长度至少6个字符');
    });
  });

  // ========== batchUpdateStatus() 测试 ==========
  describe('batchUpdateStatus() - 批量更新状态', () => {

    test('空用户列表：应抛出错误', async () => {
      await expect(UserService.batchUpdateStatus([], 'active'))
        .rejects.toThrow('用户ID列表不能为空');
    });

    test('非数组：应抛出错误', async () => {
      await expect(UserService.batchUpdateStatus('not-array', 'active'))
        .rejects.toThrow('用户ID列表不能为空');
    });

    test('无效状态值：应抛出错误', async () => {
      await expect(UserService.batchUpdateStatus([1, 2], 'invalid'))
        .rejects.toThrow('无效的用户状态');
    });

    test('合法状态active/inactive/suspended：应通过', async () => {
      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn().mockResolvedValue({ rows: { affectedRows: 2 } });
        return await cb(qfn);
      });

      const result = await UserService.batchUpdateStatus([1, 2], 'active');
      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(2);
    });
  });

  // ========== batchCreateUsers() 参数验证测试 ==========
  describe('batchCreateUsers() - 批量创建用户参数验证', () => {

    const mockCurrentUser = { id: 99, role: 'super_admin', group_id: 1 };

    test('无group_id：应抛出错误', async () => {
      await expect(UserService.batchCreateUsers({
        username_prefix: 'stu',
        count: 5
      }, mockCurrentUser)).rejects.toThrow('请选择目标用户组');
    });

    test('用户名前缀为空：应抛出错误', async () => {
      await expect(UserService.batchCreateUsers({
        group_id: 1,
        username_prefix: '',
        count: 5
      }, mockCurrentUser)).rejects.toThrow('用户名前缀不能为空');
    });

    test('数量超过500：应抛出错误', async () => {
      await expect(UserService.batchCreateUsers({
        group_id: 1,
        username_prefix: 'stu',
        count: 501
      }, mockCurrentUser)).rejects.toThrow('创建数量必须在1-500之间');
    });

    test('数量为0：应抛出错误', async () => {
      await expect(UserService.batchCreateUsers({
        group_id: 1,
        username_prefix: 'stu',
        count: 0
      }, mockCurrentUser)).rejects.toThrow('创建数量必须在1-500之间');
    });

    test('积分为负数：应抛出错误', async () => {
      await expect(UserService.batchCreateUsers({
        group_id: 1,
        username_prefix: 'stu',
        count: 5,
        credits_per_user: -10
      }, mockCurrentUser)).rejects.toThrow('每用户积分不能为负数');
    });

    test('用户名前缀含特殊字符：应抛出错误', async () => {
      await expect(UserService.batchCreateUsers({
        group_id: 1,
        username_prefix: 'stu@#$',
        count: 5
      }, mockCurrentUser)).rejects.toThrow('用户名前缀只能包含字母、数字');
    });

    test('组管理员跨组创建：应抛出权限错误', async () => {
      const adminUser = { id: 50, role: 'admin', group_id: 2 };

      await expect(UserService.batchCreateUsers({
        group_id: 1,
        username_prefix: 'stu',
        count: 5
      }, adminUser)).rejects.toThrow('组管理员只能为本组创建用户');
    });
  });
});
