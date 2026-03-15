/**
 * KnowledgeModule - 知识模块模型单元测试
 * 
 * 测试范围：
 * - constructor()           构造函数（默认值、字段初始化）
 * - normalizeGroupIds()     group_ids规范化（字符串/数组/空值/类型转换）
 * - toJSON()                JSON序列化（内容可见性、content_hidden标识）
 * - checkUserAccess()       用户访问权限（个人/团队/系统三种scope + 超管特权）
 * 
 * Mock策略：
 * - 数据库连接全Mock，只测业务逻辑
 * - checkUserAccess涉及多次查询，通过mockQuery序列模拟
 */

// ========== Mock外部依赖 ==========

const mockQuery = jest.fn();
jest.mock('../../../database/connection', () => ({
  query: mockQuery,
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

jest.mock('../../../utils/tokenCalculator', () => ({
  calculateTokens: jest.fn().mockReturnValue(100)
}));

// ========== 引入被测模块 ==========
const KnowledgeModule = require('../../../models/KnowledgeModule');

// ========== 测试套件 ==========

describe('KnowledgeModule - 知识模块模型', () => {

  // ========== constructor 测试 ==========
  describe('constructor() - 构造函数', () => {

    test('应正确初始化所有字段', () => {
      const module = new KnowledgeModule({
        id: 1,
        name: '测试模块',
        content: '知识内容',
        module_scope: 'system',
        content_visible: false,
        creator_id: 10,
        group_id: 2
      });

      expect(module.id).toBe(1);
      expect(module.name).toBe('测试模块');
      expect(module.content).toBe('知识内容');
      expect(module.module_scope).toBe('system');
      expect(module.content_visible).toBe(false);
      expect(module.creator_id).toBe(10);
    });

    test('空数据应使用默认值', () => {
      const module = new KnowledgeModule();

      expect(module.id).toBeNull();
      expect(module.name).toBe('');
      expect(module.content).toBe('');
      expect(module.module_scope).toBe('personal');
      expect(module.content_visible).toBe(true);
      expect(module.is_active).toBe(true);
      expect(module.prompt_type).toBe('normal');
      expect(module.allowed_tag_ids).toEqual([]);
    });

    test('content_visible为0（MySQL返回值）：应为falsy', () => {
      const module = new KnowledgeModule({ content_visible: 0 });
      expect(module.content_visible).toBeFalsy();
    });
  });

  // ========== normalizeGroupIds() 测试 ==========
  describe('normalizeGroupIds() - group_ids规范化', () => {

    test('null：应返回null', () => {
      expect(KnowledgeModule.normalizeGroupIds(null)).toBeNull();
    });

    test('undefined：应返回null', () => {
      expect(KnowledgeModule.normalizeGroupIds(undefined)).toBeNull();
    });

    test('整数数组[1,2,3]：应原样返回', () => {
      expect(KnowledgeModule.normalizeGroupIds([1, 2, 3])).toEqual([1, 2, 3]);
    });

    test('字符串数组["1","2"]：应转换为整数', () => {
      expect(KnowledgeModule.normalizeGroupIds(['1', '2'])).toEqual([1, 2]);
    });

    test('JSON字符串"[1,2,3]"：应解析并返回整数数组', () => {
      expect(KnowledgeModule.normalizeGroupIds('[1,2,3]')).toEqual([1, 2, 3]);
    });

    test('混合类型数组[1,"2",3]：应统一为整数', () => {
      expect(KnowledgeModule.normalizeGroupIds([1, '2', 3])).toEqual([1, 2, 3]);
    });

    test('包含无效值[1,"abc",-1,0]：应过滤掉非正整数', () => {
      expect(KnowledgeModule.normalizeGroupIds([1, 'abc', -1, 0])).toEqual([1]);
    });

    test('空数组[]：应返回null', () => {
      expect(KnowledgeModule.normalizeGroupIds([])).toBeNull();
    });

    test('全部无效值["abc","def"]：应返回null', () => {
      expect(KnowledgeModule.normalizeGroupIds(['abc', 'def'])).toBeNull();
    });

    test('非法JSON字符串：应返回null', () => {
      expect(KnowledgeModule.normalizeGroupIds('not-json')).toBeNull();
    });

    test('非数组非字符串（数字）：应返回null', () => {
      expect(KnowledgeModule.normalizeGroupIds(123)).toBeNull();
    });
  });

  // ========== toJSON() 测试 ==========
  describe('toJSON() - JSON序列化', () => {

    test('正常模块：应包含content', () => {
      const module = new KnowledgeModule({
        id: 1,
        name: '测试',
        content: '这是内容'
      });

      const json = module.toJSON();
      expect(json.content).toBe('这是内容');
      expect(json.content_hidden).toBeUndefined();
    });

    test('内容被隐藏的模块：应有content_hidden标识且无content', () => {
      const module = new KnowledgeModule({
        id: 1,
        name: '黑盒模块',
        content: null
      });
      module.content_hidden = true;

      const json = module.toJSON();
      expect(json.content_hidden).toBe(true);
      expect(json.content).toBeUndefined();
    });

    test('应包含creator_name和group_name（如果有）', () => {
      const module = new KnowledgeModule({ id: 1, name: '测试' });
      module.creator_name = '管理员';
      module.group_name = '教学组';

      const json = module.toJSON();
      expect(json.creator_name).toBe('管理员');
      expect(json.group_name).toBe('教学组');
    });

    test('无额外信息时不应包含creator_name/group_name', () => {
      const module = new KnowledgeModule({ id: 1 });

      const json = module.toJSON();
      expect(json.creator_name).toBeUndefined();
      expect(json.group_name).toBeUndefined();
    });
  });

  // ========== checkUserAccess() 测试 ==========
  describe('checkUserAccess() - 用户访问权限', () => {

    beforeEach(() => {
      mockQuery.mockReset();
    });

    test('超级管理员：应始终有权限', async () => {
      const result = await KnowledgeModule.checkUserAccess(1, 99, 1, 'super_admin');
      expect(result).toBe(true);
      // 超管不需要任何数据库查询
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('个人模块-创建者访问：应有权限', async () => {
      // 查询用户标签
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 查询模块信息
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, module_scope: 'personal', creator_id: 5, group_id: null, group_ids: null, tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(1, 5, 1, 'user');
      expect(result).toBe(true);
    });

    test('个人模块-非创建者访问：应无权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, module_scope: 'personal', creator_id: 5, group_id: null, group_ids: null, tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(1, 99, 1, 'user');
      expect(result).toBe(false);
    });

    test('团队模块-同组无标签限制：应有权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 2, module_scope: 'team', creator_id: 10, group_id: 1, group_ids: null, tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(2, 5, 1, 'user');
      expect(result).toBe(true);
    });

    test('团队模块-不同组：应无权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 2, module_scope: 'team', creator_id: 10, group_id: 2, group_ids: null, tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(2, 5, 1, 'user');
      expect(result).toBe(false);
    });

    test('系统模块-group_ids为NULL(所有组可见)：应有权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 3, module_scope: 'system', creator_id: 1, group_id: null, group_ids: null, tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(3, 5, 1, 'user');
      expect(result).toBe(true);
    });

    test('系统模块-用户组在允许列表中：应有权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 3, module_scope: 'system', creator_id: 1, group_id: null, group_ids: '[1,2,3]', tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(3, 5, 2, 'user');
      expect(result).toBe(true);
    });

    test('系统模块-用户组不在允许列表中：应无权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 3, module_scope: 'system', creator_id: 1, group_id: null, group_ids: '[1,2]', tag_permission_count: 0 }]
      });

      const result = await KnowledgeModule.checkUserAccess(3, 5, 99, 'user');
      expect(result).toBe(false);
    });

    test('模块不存在或未激活：应无权限', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await KnowledgeModule.checkUserAccess(999, 5, 1, 'user');
      expect(result).toBe(false);
    });
  });
});
