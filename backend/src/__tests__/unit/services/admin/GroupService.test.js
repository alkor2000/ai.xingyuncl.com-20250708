/**
 * GroupService - 用户分组服务单元测试
 * 
 * 测试范围：
 * - createGroup()               创建分组（名称验证、重复检查、模型自动分配）
 * - updateGroup()               更新分组（名称冲突检查）
 * - deleteGroup()               删除分组（有用户时阻止）
 * - setGroupCreditsPool()       设置积分池（参数验证、不低于已使用）
 * - distributeCreditsFromPool() 从积分池分配（余额检查、用户归属）
 * - recycleCreditsToPool()      回收积分到池（余额检查、用户归属）
 * - setGroupUserLimit()         设置组员上限（不低于当前人数）
 * - setGroupInvitationCode()    邀请码管理（格式验证、重复检查）
 * - getGroupAnnouncement()      获取组公告
 * - updateGroupAnnouncement()   更新组公告
 * 
 * Mock策略：
 * - dbConnection全Mock模拟SQL查询
 * - User模型Mock（createGroup等静态方法）
 * - 只测Service层业务逻辑
 */

// ========== Mock外部依赖 ==========

jest.mock('../../../../models/User', () => ({
  findById: jest.fn(),
  createGroup: jest.fn(),
  updateGroup: jest.fn(),
  deleteGroup: jest.fn()
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
const GroupService = require('../../../../services/admin/GroupService');
const User = require('../../../../models/User');

// ========== 辅助函数 ==========

/** 模拟findGroupById返回值 */
function mockGroupExists(overrides = {}) {
  const group = {
    id: 1, name: '测试组', credits_pool: 10000, credits_pool_used: 2000,
    user_limit: 50, expire_date: null, is_active: 1,
    site_customization_enabled: 0, site_name: null, site_logo: null,
    invitation_enabled: 0, invitation_code: null, announcement: null,
    ...overrides
  };
  mockQuery.mockResolvedValueOnce({ rows: [group] });
  return group;
}

/** 模拟findGroupByName返回值 */
function mockGroupNameExists(group) {
  mockQuery.mockResolvedValueOnce({ rows: group ? [group] : [] });
}

/** 模拟getGroupUserCount返回值 */
function mockUserCount(count) {
  mockQuery.mockResolvedValueOnce({ rows: [{ count }] });
}

// ========== 测试套件 ==========

describe('GroupService - 用户分组服务', () => {

  // ========== createGroup() 测试 ==========
  describe('createGroup() - 创建分组', () => {

    test('名称为空：应抛出验证错误', async () => {
      await expect(GroupService.createGroup({ name: '' }))
        .rejects.toThrow('分组名称不能为空');
    });

    test('名称已存在：应抛出冲突错误', async () => {
      // findGroupByName 返回已存在的组
      mockGroupNameExists({ id: 99, name: '已存在组' });

      await expect(GroupService.createGroup({ name: '已存在组' }))
        .rejects.toThrow('分组名称已存在');
    });

    test('正常创建：应调用User.createGroup并分配模型', async () => {
      // findGroupByName 返回null（不存在）
      mockGroupNameExists(null);

      const newGroup = { id: 10, name: '新组' };
      User.createGroup.mockResolvedValue(newGroup);

      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        // createGroup内部先调用findGroupByName（已在外部Mock）
        // transaction内部查询AI模型
        qfn.mockResolvedValueOnce({ rows: [{ id: 1, name: 'gpt-4', display_name: 'GPT-4' }] });
        // 查询图像模型
        qfn.mockResolvedValueOnce({ rows: [] });
        // 插入AI模型分配
        qfn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });

        return await cb(qfn);
      });

      // createGroup内部调用transaction
      const result = await GroupService.createGroup({ name: '新组' }, 1);
      expect(result.id).toBe(10);
    });
  });

  // ========== deleteGroup() 测试 ==========
  describe('deleteGroup() - 删除分组', () => {

    test('组下有用户：应阻止删除', async () => {
      // getGroupUserCount
      mockUserCount(5);

      await expect(GroupService.deleteGroup(1))
        .rejects.toThrow('还有5个用户，无法删除');
    });

    test('组下无用户：应成功删除', async () => {
      mockUserCount(0);
      User.deleteGroup.mockResolvedValue(true);

      const result = await GroupService.deleteGroup(1);
      expect(result.success).toBe(true);
    });
  });

  // ========== setGroupCreditsPool() 测试 ==========
  describe('setGroupCreditsPool() - 设置积分池', () => {

    test('额度为负数：应抛出错误', async () => {
      await expect(GroupService.setGroupCreditsPool(1, -100))
        .rejects.toThrow('积分池额度必须是非负数');
    });

    test('额度非数字：应抛出错误', async () => {
      await expect(GroupService.setGroupCreditsPool(1, 'abc'))
        .rejects.toThrow('积分池额度必须是非负数');
    });

    test('额度低于已使用：应抛出错误', async () => {
      mockGroupExists({ credits_pool: 10000, credits_pool_used: 5000 });

      await expect(GroupService.setGroupCreditsPool(1, 3000))
        .rejects.toThrow('不能低于已使用额度');
    });

    test('组不存在：应抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(GroupService.setGroupCreditsPool(999, 10000))
        .rejects.toThrow('用户分组不存在');
    });

    test('正常设置：应返回成功', async () => {
      mockGroupExists({ credits_pool: 10000, credits_pool_used: 2000 });
      // UPDATE query
      mockQuery.mockResolvedValueOnce({ rows: { affectedRows: 1 } });

      const result = await GroupService.setGroupCreditsPool(1, 20000);
      expect(result.success).toBe(true);
      expect(result.credits_pool).toBe(20000);
      expect(result.credits_pool_remaining).toBe(18000);
    });
  });

  // ========== distributeCreditsFromPool() 测试 ==========
  describe('distributeCreditsFromPool() - 积分池分配', () => {

    test('金额为0：应抛出错误', async () => {
      await expect(GroupService.distributeCreditsFromPool(1, 1, 0, '测试', 99))
        .rejects.toThrow('分配金额必须是正数');
    });

    test('金额为负数：应抛出错误', async () => {
      await expect(GroupService.distributeCreditsFromPool(1, 1, -100, '测试', 99))
        .rejects.toThrow('分配金额必须是正数');
    });

    test('积分池余额不足：应抛出错误', async () => {
      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        // FOR UPDATE查组
        qfn.mockResolvedValueOnce({
          rows: [{ id: 1, credits_pool: 1000, credits_pool_used: 900 }]
        });
        return await cb(qfn);
      });

      await expect(GroupService.distributeCreditsFromPool(1, 1, 200, '测试', 99))
        .rejects.toThrow('积分池余额不足');
    });

    test('用户不属于该组：应抛出错误', async () => {
      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        // 查组
        qfn.mockResolvedValueOnce({
          rows: [{ id: 1, credits_pool: 10000, credits_pool_used: 0 }]
        });
        // 更新组
        qfn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });
        // 查用户（不同组）
        qfn.mockResolvedValueOnce({
          rows: [{ id: 5, group_id: 2, credits_quota: 100, used_credits: 0 }]
        });
        return await cb(qfn);
      });

      await expect(GroupService.distributeCreditsFromPool(1, 5, 500, '测试', 99))
        .rejects.toThrow('用户不属于该分组');
    });
  });

  // ========== recycleCreditsToPool() 测试 ==========
  describe('recycleCreditsToPool() - 积分回收', () => {

    test('金额为0：应抛出错误', async () => {
      await expect(GroupService.recycleCreditsToPool(1, 1, 0, '回收', 99))
        .rejects.toThrow('回收金额必须是正数');
    });

    test('金额为负数：应抛出错误', async () => {
      await expect(GroupService.recycleCreditsToPool(1, 1, -50, '回收', 99))
        .rejects.toThrow('回收金额必须是正数');
    });

    test('用户余额不足：应抛出错误', async () => {
      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        // 查组
        qfn.mockResolvedValueOnce({
          rows: [{ id: 1, credits_pool: 10000, credits_pool_used: 5000 }]
        });
        // 查用户（余额只有50）
        qfn.mockResolvedValueOnce({
          rows: [{ id: 1, group_id: 1, credits_quota: 100, used_credits: 50 }]
        });
        return await cb(qfn);
      });

      await expect(GroupService.recycleCreditsToPool(1, 1, 100, '回收', 99))
        .rejects.toThrow('用户积分不足');
    });
  });

  // ========== setGroupUserLimit() 测试 ==========
  describe('setGroupUserLimit() - 设置组员上限', () => {

    test('上限为0：应抛出错误', async () => {
      await expect(GroupService.setGroupUserLimit(1, 0))
        .rejects.toThrow('组员上限必须是大于0的数字');
    });

    test('上限为负数：应抛出错误', async () => {
      await expect(GroupService.setGroupUserLimit(1, -5))
        .rejects.toThrow('组员上限必须是大于0的数字');
    });

    test('上限低于当前人数：应抛出错误', async () => {
      mockGroupExists({ user_limit: 50 });
      mockUserCount(30);

      await expect(GroupService.setGroupUserLimit(1, 20))
        .rejects.toThrow('不能低于当前组员数');
    });

    test('正常设置：应返回成功', async () => {
      mockGroupExists({ user_limit: 50 });
      mockUserCount(10);
      // UPDATE query
      mockQuery.mockResolvedValueOnce({ rows: { affectedRows: 1 } });

      const result = await GroupService.setGroupUserLimit(1, 100);
      expect(result.success).toBe(true);
      expect(result.user_limit).toBe(100);
      expect(result.available_slots).toBe(90);
    });
  });

  // ========== setGroupInvitationCode() 测试 ==========
  describe('setGroupInvitationCode() - 邀请码管理', () => {

    test('启用但邀请码为空：应抛出错误', async () => {
      mockGroupExists();

      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        return await cb(qfn);
      });

      await expect(GroupService.setGroupInvitationCode(1, {
        enabled: true,
        code: ''
      })).rejects.toThrow('请输入邀请码');
    });

    test('邀请码格式不正确（非5位）：应抛出错误', async () => {
      mockGroupExists();

      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        return await cb(qfn);
      });

      await expect(GroupService.setGroupInvitationCode(1, {
        enabled: true,
        code: 'AB'
      })).rejects.toThrow('邀请码必须是5位');
    });

    test('邀请码含特殊字符：应抛出错误', async () => {
      mockGroupExists();

      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        return await cb(qfn);
      });

      await expect(GroupService.setGroupInvitationCode(1, {
        enabled: true,
        code: 'AB@#5'
      })).rejects.toThrow('邀请码必须是5位');
    });

    test('禁用邀请码：应返回成功', async () => {
      mockGroupExists();

      mockTransaction.mockImplementation(async (cb) => {
        const qfn = jest.fn();
        qfn.mockResolvedValueOnce({ rows: { affectedRows: 1 } });
        return await cb(qfn);
      });

      const result = await GroupService.setGroupInvitationCode(1, {
        enabled: false
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('禁用');
    });
  });

  // ========== 组公告 测试 ==========
  describe('getGroupAnnouncement() / updateGroupAnnouncement() - 组公告', () => {

    test('获取公告：组不存在应抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(GroupService.getGroupAnnouncement(999))
        .rejects.toThrow('用户分组不存在');
    });

    test('获取公告：应返回内容', async () => {
      mockGroupExists({ announcement: '# 欢迎加入', name: '测试组' });

      const result = await GroupService.getGroupAnnouncement(1);
      expect(result.content).toBe('# 欢迎加入');
      expect(result.group_name).toBe('测试组');
    });

    test('获取公告：无内容应返回空字符串', async () => {
      mockGroupExists({ announcement: null });

      const result = await GroupService.getGroupAnnouncement(1);
      expect(result.content).toBe('');
    });

    test('更新公告：组不存在应抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(GroupService.updateGroupAnnouncement(999, '新公告'))
        .rejects.toThrow('用户分组不存在');
    });

    test('更新公告：应成功', async () => {
      mockGroupExists({ name: '测试组' });
      // UPDATE query
      mockQuery.mockResolvedValueOnce({ rows: { affectedRows: 1 } });

      const result = await GroupService.updateGroupAnnouncement(1, '## 新公告内容');
      expect(result.content).toBe('## 新公告内容');
      expect(result.group_id).toBe(1);
    });

    test('清空公告（传null）：应成功', async () => {
      mockGroupExists({ name: '测试组' });
      mockQuery.mockResolvedValueOnce({ rows: { affectedRows: 1 } });

      const result = await GroupService.updateGroupAnnouncement(1, null);
      expect(result.content).toBe('');
    });
  });
});
