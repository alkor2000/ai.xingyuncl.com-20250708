/**
 * SmartApp - 智能应用模型单元测试
 * 
 * 测试范围：
 * - constructor()           构造函数（字段初始化、类型转换、默认值）
 * - _parseCategoryIds()     category_ids解析（JSON字符串/数组/空值）
 * - toJSON()                用户端JSON序列化
 * - toFullJSON()            管理端JSON序列化（含system_prompt）
 * - create() 参数验证       必填项检查、温度/积分范围钳制
 * 
 * Mock策略：
 * - 数据库连接全Mock
 * - 只测模型层业务逻辑和数据转换
 */

// ========== Mock外部依赖 ==========

const mockQuery = jest.fn();
const mockSimpleQuery = jest.fn();
jest.mock('../../../database/connection', () => ({
  query: mockQuery,
  simpleQuery: mockSimpleQuery
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块 ==========
const SmartApp = require('../../../models/SmartApp');

// ========== 测试套件 ==========

describe('SmartApp - 智能应用模型', () => {

  // ========== constructor 测试 ==========
  describe('constructor() - 构造函数', () => {

    test('应正确初始化所有字段', () => {
      const app = new SmartApp({
        id: 1,
        name: '翻译助手',
        description: '多语言翻译',
        icon: '🌐',
        system_prompt: '你是翻译专家',
        temperature: '0.3',
        context_length: '20',
        model_id: 5,
        credits_per_use: 10,
        is_published: 1,
        category_ids: '[1,2]'
      });

      expect(app.id).toBe(1);
      expect(app.name).toBe('翻译助手');
      expect(app.temperature).toBe(0.3);      // 字符串→数字
      expect(app.context_length).toBe(20);     // 字符串→数字
      expect(app.credits_per_use).toBe(10);
      expect(app.category_ids).toEqual([1, 2]); // JSON字符串→数组
    });

    test('空数据应使用默认值', () => {
      const app = new SmartApp();

      expect(app.id).toBeNull();
      expect(app.temperature).toBe(0.7);
      expect(app.context_length).toBe(10);
      expect(app.credits_per_use).toBe(0);
      expect(app.is_published).toBe(0);
      expect(app.is_stream).toBe(1);
      expect(app.category_ids).toEqual([]);
      expect(app.is_favorited).toBe(false);
    });

    test('temperature为NaN字符串：应使用默认0.7', () => {
      const app = new SmartApp({ temperature: 'abc' });
      expect(app.temperature).toBe(0.7);
    });

    test('credits_per_use超出范围：应被钳制', () => {
      const app1 = new SmartApp({ credits_per_use: -5 });
      expect(app1.credits_per_use).toBe(0);

      const app2 = new SmartApp({ credits_per_use: 99999 });
      expect(app2.credits_per_use).toBe(9999);
    });

    test('is_favorited从数据库查询结果：1→true', () => {
      const app = new SmartApp({ is_favorited: 1 });
      expect(app.is_favorited).toBeTruthy();
    });
  });

  // ========== _parseCategoryIds() 测试 ==========
  describe('_parseCategoryIds() - 分类ID解析', () => {

    test('JSON字符串"[1,2,3]"：应解析为数组', () => {
      const app = new SmartApp();
      expect(app._parseCategoryIds('[1,2,3]')).toEqual([1, 2, 3]);
    });

    test('已是数组[1,2]：应原样返回', () => {
      const app = new SmartApp();
      expect(app._parseCategoryIds([1, 2])).toEqual([1, 2]);
    });

    test('null：应返回空数组', () => {
      const app = new SmartApp();
      expect(app._parseCategoryIds(null)).toEqual([]);
    });

    test('undefined：应返回空数组', () => {
      const app = new SmartApp();
      expect(app._parseCategoryIds(undefined)).toEqual([]);
    });

    test('非法JSON字符串：应返回空数组', () => {
      const app = new SmartApp();
      expect(app._parseCategoryIds('not-json')).toEqual([]);
    });

    test('数字类型：应返回空数组', () => {
      const app = new SmartApp();
      expect(app._parseCategoryIds(123)).toEqual([]);
    });
  });

  // ========== toJSON() 测试 ==========
  describe('toJSON() - 用户端JSON序列化', () => {

    test('应包含所有用户可见字段', () => {
      const app = new SmartApp({
        id: 1,
        name: '测试应用',
        description: '描述',
        temperature: 0.5,
        credits_per_use: 5,
        is_favorited: true
      });

      const json = app.toJSON();
      expect(json.id).toBe(1);
      expect(json.name).toBe('测试应用');
      expect(json.temperature).toBe(0.5);
      expect(json.credits_per_use).toBe(5);
      expect(json.is_favorited).toBe(true);
    });

    test('不应包含system_prompt（用户端隐藏）', () => {
      const app = new SmartApp({
        id: 1,
        system_prompt: '这是机密提示词'
      });

      const json = app.toJSON();
      expect(json.system_prompt).toBeUndefined();
    });

    test('不应包含creator_id（用户端隐藏）', () => {
      const app = new SmartApp({ id: 1, creator_id: 99 });

      const json = app.toJSON();
      expect(json.creator_id).toBeUndefined();
    });
  });

  // ========== toFullJSON() 测试 ==========
  describe('toFullJSON() - 管理端JSON序列化', () => {

    test('应包含system_prompt和creator信息', () => {
      const app = new SmartApp({
        id: 1,
        name: '测试',
        system_prompt: '你是专家',
        creator_id: 99
      });
      app.creator_username = 'admin';

      const json = app.toFullJSON();
      expect(json.system_prompt).toBe('你是专家');
      expect(json.creator_id).toBe(99);
      expect(json.creator_username).toBe('admin');
    });

    test('应包含toJSON的所有字段', () => {
      const app = new SmartApp({
        id: 1,
        name: '测试',
        temperature: 0.8,
        credits_per_use: 10
      });

      const json = app.toFullJSON();
      expect(json.temperature).toBe(0.8);
      expect(json.credits_per_use).toBe(10);
      expect(json.is_favorited).toBeDefined();
    });
  });

  // ========== create() 参数验证 测试 ==========
  describe('create() - 创建智能应用参数验证', () => {

    test('缺少name：应抛出错误', async () => {
      await expect(SmartApp.create({
        model_id: 1,
        creator_id: 1
      })).rejects.toThrow('必填项');
    });

    test('缺少model_id：应抛出错误', async () => {
      await expect(SmartApp.create({
        name: '测试',
        creator_id: 1
      })).rejects.toThrow('必填项');
    });

    test('缺少creator_id：应抛出错误', async () => {
      await expect(SmartApp.create({
        name: '测试',
        model_id: 1
      })).rejects.toThrow('必填项');
    });

    test('正常参数：应调用数据库插入', async () => {
      mockQuery.mockResolvedValueOnce({ rows: { insertId: 10 } });
      // findById查询
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 10, name: '新应用', model_id: 1, creator_id: 1,
          temperature: 0.7, context_length: 10, credits_per_use: 0,
          category_ids: '[]', is_published: 0
        }]
      });

      const result = await SmartApp.create({
        name: '新应用',
        model_id: 1,
        creator_id: 1
      });

      expect(result.id).toBe(10);
      expect(mockQuery).toHaveBeenCalled();
    });

    test('温度超范围：应被钳制到0-2', async () => {
      mockQuery.mockResolvedValueOnce({ rows: { insertId: 11 } });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 11, name: '测试', temperature: 2, category_ids: '[]' }]
      });

      await SmartApp.create({
        name: '测试',
        model_id: 1,
        creator_id: 1,
        temperature: 5.0  // 超出范围，应钳制为2
      });

      // 检查传入数据库的温度值
      const insertCall = mockQuery.mock.calls[0];
      const temperatureParam = insertCall[1][4]; // 第5个参数是temperature
      expect(temperatureParam).toBe(2);
    });

    test('category_ids最多3个：应截断', async () => {
      mockQuery.mockResolvedValueOnce({ rows: { insertId: 12 } });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 12, name: '测试', category_ids: '[1,2,3]' }]
      });

      await SmartApp.create({
        name: '测试',
        model_id: 1,
        creator_id: 1,
        category_ids: [1, 2, 3, 4, 5]  // 超过3个
      });

      const insertCall = mockQuery.mock.calls[0];
      const categoryIdsParam = insertCall[1][8]; // 第9个参数是category_ids
      expect(JSON.parse(categoryIdsParam)).toHaveLength(3);
    });
  });
});
