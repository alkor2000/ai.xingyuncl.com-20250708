/**
 * ConversationService - 会话服务单元测试
 * 
 * 测试范围：
 * - validateContextLength()    上下文长度验证与规范化
 * - validateTemperature()      温度参数验证与规范化
 * - prepareConversationData()  创建会话前的完整数据准备（模型/提示词/组合权限）
 * - validateUpdatePermissions() 更新会话时的权限验证
 * 
 * Mock策略：
 * - AIModel、SystemPrompt、ModuleCombination 模拟数据库查询
 * - CacheService 模拟缓存层
 * - 只测试业务逻辑，不触及真实数据库
 */

// ========== Mock外部依赖（必须在require之前） ==========

jest.mock('../../../../models/Conversation');

jest.mock('../../../../models/SystemPrompt', () => ({
  getUserAvailablePrompts: jest.fn()
}));

jest.mock('../../../../models/ModuleCombination', () => ({
  findById: jest.fn()
}));

jest.mock('../../../../models/AIModel', () => ({
  getUserAvailableModels: jest.fn()
}));

jest.mock('../../../../services/cacheService', () => ({
  getCachedUserModels: jest.fn()
}));

jest.mock('../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../../database/connection', () => ({
  query: jest.fn(),
  simpleQuery: jest.fn(),
  transaction: jest.fn()
}));

// ========== 引入被测模块 ==========
const ConversationService = require('../../../../services/chat/ConversationService');
const SystemPrompt = require('../../../../models/SystemPrompt');
const ModuleCombination = require('../../../../models/ModuleCombination');
const CacheService = require('../../../../services/cacheService');

// ========== 测试套件 ==========

describe('ConversationService - 会话服务', () => {

  // ========== validateContextLength() 测试 ==========
  describe('validateContextLength() - 上下文长度验证', () => {
    test('正常值20：应原样返回', () => {
      expect(ConversationService.validateContextLength(20)).toBe(20);
    });

    test('字符串"50"：应解析为数字50', () => {
      expect(ConversationService.validateContextLength('50')).toBe(50);
    });

    test('负数-10：应被钳制为0', () => {
      expect(ConversationService.validateContextLength(-10)).toBe(0);
    });

    test('超大值2000：应被钳制为1000', () => {
      expect(ConversationService.validateContextLength(2000)).toBe(1000);
    });

    test('边界值0：parseInt(0)||20 为falsy走默认值，应返回20', () => {
      // 源码逻辑：parseInt(0) 结果是0，0是falsy，所以 0 || 20 = 20
      // 这是源码的实际行为，0会被当作"未设置"走默认值
      expect(ConversationService.validateContextLength(0)).toBe(20);
    });

    test('边界值1000：应返回1000', () => {
      expect(ConversationService.validateContextLength(1000)).toBe(1000);
    });

    test('undefined/NaN：应返回默认值20', () => {
      expect(ConversationService.validateContextLength(undefined)).toBe(20);
      expect(ConversationService.validateContextLength('abc')).toBe(20);
      expect(ConversationService.validateContextLength(null)).toBe(20);
    });

    test('最小正值1：应返回1', () => {
      expect(ConversationService.validateContextLength(1)).toBe(1);
    });
  });

  // ========== validateTemperature() 测试 ==========
  describe('validateTemperature() - 温度参数验证', () => {
    test('正常值0.7：应原样返回', () => {
      expect(ConversationService.validateTemperature(0.7)).toBe(0.7);
    });

    test('字符串"0.5"：应解析为0.5', () => {
      expect(ConversationService.validateTemperature('0.5')).toBe(0.5);
    });

    test('负数-0.5：应被钳制为0', () => {
      expect(ConversationService.validateTemperature(-0.5)).toBe(0);
    });

    test('超大值1.5：应被钳制为1.0', () => {
      expect(ConversationService.validateTemperature(1.5)).toBe(1.0);
    });

    test('边界值0：应返回0', () => {
      expect(ConversationService.validateTemperature(0)).toBe(0);
    });

    test('边界值1.0：应返回1.0', () => {
      expect(ConversationService.validateTemperature(1.0)).toBe(1.0);
    });

    test('undefined/NaN：应返回默认值0', () => {
      expect(ConversationService.validateTemperature(undefined)).toBe(0);
      expect(ConversationService.validateTemperature('abc')).toBe(0);
      expect(ConversationService.validateTemperature(null)).toBe(0);
    });
  });

  // ========== prepareConversationData() 测试 ==========
  describe('prepareConversationData() - 创建会话数据准备', () => {

    beforeEach(() => {
      // 默认：缓存返回可用模型列表
      CacheService.getCachedUserModels.mockImplementation(
        async (userId, groupId, fetchFn) => {
          return [
            { name: 'gpt-4', credits_per_chat: 10 },
            { name: 'claude-3', credits_per_chat: 15 }
          ];
        }
      );
    });

    test('正常参数：应返回规范化的会话数据', async () => {
      const result = await ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        title: '测试对话',
        model_name: 'gpt-4',
        context_length: 30,
        ai_temperature: 0.8,
        priority: 5
      });

      expect(result.user_id).toBe(1);
      expect(result.title).toBe('测试对话');
      expect(result.model_name).toBe('gpt-4');
      expect(result.context_length).toBe(30);
      expect(result.ai_temperature).toBe(0.8);
      expect(result.priority).toBe(5);
      expect(result.system_prompt_id).toBeNull();
      expect(result.module_combination_id).toBeNull();
    });

    test('model_name为空：应抛出错误', async () => {
      await expect(ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: ''
      })).rejects.toThrow('模型名称不能为空');
    });

    test('模型不在可用列表中：应抛出权限错误', async () => {
      await expect(ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-5-not-exist'
      })).rejects.toThrow('无权使用该模型');
    });

    test('无标题：应默认为New Chat', async () => {
      const result = await ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4'
      });

      expect(result.title).toBe('New Chat');
    });

    test('带系统提示词ID且有权限：应正常通过', async () => {
      SystemPrompt.getUserAvailablePrompts.mockResolvedValue([
        { id: 10, name: '翻译助手' }
      ]);

      const result = await ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4',
        system_prompt_id: 10
      });

      expect(result.system_prompt_id).toBe(10);
    });

    test('带系统提示词ID但无权限：应抛出错误', async () => {
      SystemPrompt.getUserAvailablePrompts.mockResolvedValue([
        { id: 10, name: '翻译助手' }
      ]);

      await expect(ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4',
        system_prompt_id: 999
      })).rejects.toThrow('无权使用该系统提示词');
    });

    test('带模块组合ID且有权限：应正常通过', async () => {
      ModuleCombination.findById.mockResolvedValue({
        id: 5,
        user_id: 1,
        name: '测试组合'
      });

      const result = await ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4',
        module_combination_id: 5
      });

      expect(result.module_combination_id).toBe(5);
    });

    test('模块组合不存在：应抛出错误', async () => {
      ModuleCombination.findById.mockResolvedValue(null);

      await expect(ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4',
        module_combination_id: 999
      })).rejects.toThrow('模块组合不存在');
    });

    test('模块组合属于其他用户：应抛出权限错误', async () => {
      ModuleCombination.findById.mockResolvedValue({
        id: 5,
        user_id: 99,
        name: '别人的组合'
      });

      await expect(ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4',
        module_combination_id: 5
      })).rejects.toThrow('无权使用该模块组合');
    });

    test('参数规范化：超范围值应被钳制', async () => {
      const result = await ConversationService.prepareConversationData({
        userId: 1,
        userGroupId: 1,
        model_name: 'gpt-4',
        context_length: 9999,
        ai_temperature: 5.0
      });

      expect(result.context_length).toBe(1000);
      expect(result.ai_temperature).toBe(1.0);
    });
  });

  // ========== validateUpdatePermissions() 测试 ==========
  describe('validateUpdatePermissions() - 会话更新权限验证', () => {

    beforeEach(() => {
      CacheService.getCachedUserModels.mockImplementation(
        async (userId, groupId, fetchFn) => {
          return [
            { name: 'gpt-4', credits_per_chat: 10 },
            { name: 'claude-3', credits_per_chat: 15 }
          ];
        }
      );
    });

    test('更换模型到有权限的模型：应通过', async () => {
      await expect(ConversationService.validateUpdatePermissions({
        conversation: { model_name: 'gpt-4', system_prompt_id: null, module_combination_id: null },
        model_name: 'claude-3',
        userId: 1,
        userGroupId: 1
      })).resolves.toBeUndefined();
    });

    test('更换到无权限的模型：应抛出错误', async () => {
      await expect(ConversationService.validateUpdatePermissions({
        conversation: { model_name: 'gpt-4', system_prompt_id: null, module_combination_id: null },
        model_name: 'unknown-model',
        userId: 1,
        userGroupId: 1
      })).rejects.toThrow('无权使用该模型');
    });

    test('模型名称未变化：应跳过模型验证', async () => {
      CacheService.getCachedUserModels.mockResolvedValue([]);

      await expect(ConversationService.validateUpdatePermissions({
        conversation: { model_name: 'gpt-4', system_prompt_id: null, module_combination_id: null },
        model_name: 'gpt-4',
        userId: 1,
        userGroupId: 1
      })).resolves.toBeUndefined();
    });

    test('更换系统提示词到无权限的：应抛出错误', async () => {
      SystemPrompt.getUserAvailablePrompts.mockResolvedValue([
        { id: 1, name: '助手' }
      ]);

      await expect(ConversationService.validateUpdatePermissions({
        conversation: { model_name: 'gpt-4', system_prompt_id: 1, module_combination_id: null },
        system_prompt_id: 999,
        userId: 1,
        userGroupId: 1
      })).rejects.toThrow('无权使用该系统提示词');
    });

    test('更换模块组合到不存在的：应抛出错误', async () => {
      ModuleCombination.findById.mockResolvedValue(null);

      await expect(ConversationService.validateUpdatePermissions({
        conversation: { model_name: 'gpt-4', system_prompt_id: null, module_combination_id: 1 },
        module_combination_id: 999,
        userId: 1,
        userGroupId: 1
      })).rejects.toThrow('模块组合不存在');
    });
  });
});
