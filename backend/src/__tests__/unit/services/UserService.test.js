/**
 * UserService 单元测试
 */

const UserService = require('../../../../services/admin/UserService');
const User = require('../../../../models/User');
const { ValidationError, ConflictError } = require('../../../../utils/errors');

// Mock User模型
jest.mock('../../../../models/User');
jest.mock('../../../../database/connection');
jest.mock('../../../../utils/logger');

describe('UserService', () => {
  beforeEach(() => {
    // 清理所有mock
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    const validUserData = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'Test123456!',
      role: 'user',
      group_id: 1
    };

    it('应该成功创建用户', async () => {
      // Mock检查结果
      User.findByEmail.mockResolvedValue(null);
      User.findByUsername.mockResolvedValue(null);
      User.create.mockResolvedValue({
        id: 1,
        ...validUserData,
        toJSON: () => ({ id: 1, ...validUserData })
      });

      const result = await UserService.createUser(validUserData);

      expect(User.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(User.findByUsername).toHaveBeenCalledWith('testuser');
      expect(User.create).toHaveBeenCalledWith({
        ...validUserData,
        email: 'test@example.com',
        status: 'active',
        token_quota: 10000,
        credits_quota: 1000,
        credits_expire_days: 365,
        remark: null
      });
      expect(result.id).toBe(1);
    });

    it('应该在邮箱已存在时抛出错误', async () => {
      User.findByEmail.mockResolvedValue({ id: 1, email: 'test@example.com' });

      await expect(UserService.createUser(validUserData))
        .rejects.toThrow('该邮箱已被注册');
    });

    it('应该在用户名已存在时抛出错误', async () => {
      User.findByEmail.mockResolvedValue(null);
      User.findByUsername.mockResolvedValue({ id: 1, username: 'testuser' });

      await expect(UserService.createUser(validUserData))
        .rejects.toThrow('该用户名已被使用');
    });

    it('应该验证必填字段', async () => {
      const invalidData = { email: 'test@example.com' };

      await expect(UserService.createUser(invalidData))
        .rejects.toThrow();
    });
  });

  describe('updateUser', () => {
    it('应该成功更新用户信息', async () => {
      const mockUser = {
        id: 1,
        email: 'old@example.com',
        username: 'olduser',
        update: jest.fn().mockResolvedValue({
          id: 1,
          email: 'new@example.com',
          username: 'olduser'
        })
      };

      User.findById.mockResolvedValue(mockUser);
      User.findByEmail.mockResolvedValue(null);

      const updateData = { email: 'new@example.com' };
      const result = await UserService.updateUser(1, updateData);

      expect(User.findById).toHaveBeenCalledWith(1);
      expect(User.findByEmail).toHaveBeenCalledWith('new@example.com');
      expect(mockUser.update).toHaveBeenCalledWith(updateData);
    });

    it('应该在用户不存在时抛出错误', async () => {
      User.findById.mockResolvedValue(null);

      await expect(UserService.updateUser(999, {}))
        .rejects.toThrow('用户不存在');
    });

    it('应该在邮箱被占用时抛出错误', async () => {
      const mockUser = {
        id: 1,
        email: 'old@example.com'
      };

      User.findById.mockResolvedValue(mockUser);
      User.findByEmail.mockResolvedValue({ id: 2, email: 'new@example.com' });

      await expect(UserService.updateUser(1, { email: 'new@example.com' }))
        .rejects.toThrow('该邮箱已被其他用户使用');
    });
  });

  describe('getUserList', () => {
    it('应该返回用户列表和分页信息', async () => {
      const mockUsers = [
        { id: 1, email: 'user1@example.com' },
        { id: 2, email: 'user2@example.com' }
      ];

      User.findAll.mockResolvedValue({
        users: mockUsers,
        total: 10
      });

      const filters = { page: 1, limit: 20 };
      const result = await UserService.getUserList(filters);

      expect(User.findAll).toHaveBeenCalledWith(filters);
      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 10
      });
    });
  });

  describe('deleteUser', () => {
    it('应该成功删除用户', async () => {
      const mockUser = {
        id: 1,
        delete: jest.fn().mockResolvedValue(true)
      };

      User.findById.mockResolvedValue(mockUser);

      const result = await UserService.deleteUser(1);

      expect(User.findById).toHaveBeenCalledWith(1);
      expect(mockUser.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('应该防止删除管理员账号', async () => {
      const mockAdmin = {
        id: 1,
        role: 'admin'
      };

      User.findById.mockResolvedValue(mockAdmin);

      await expect(UserService.deleteUser(1))
        .rejects.toThrow('不能删除管理员账号');
    });
  });
});
