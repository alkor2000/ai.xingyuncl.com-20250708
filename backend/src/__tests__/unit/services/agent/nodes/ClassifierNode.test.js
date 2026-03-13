/**
 * ClassifierNode - 问题分类节点单元测试
 * 
 * 测试范围：
 * - getConfig()                  配置读取（新版data.config + 旧版data兼容）
 * - validate()                   节点配置验证（模型、分类列表）
 * - buildSystemPrompt()          系统提示词构建
 * - buildClassificationPrompt()  分类提示词构建
 * - parseClassificationResult()  分类结果解析（数字/模糊匹配/默认回退）
 * 
 * Mock策略：
 * - AIModel、AICallHelper Mock（不实际调用AI）
 * - 只测节点逻辑
 */

jest.mock('../../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../../../models/AIModel', () => ({
  findByName: jest.fn()
}));

// Mock AICallHelper（避免实际AI调用）
jest.mock('../../../../../services/agent/nodes/AICallHelper', () => ({
  callAI: jest.fn()
}));

const ClassifierNode = require('../../../../../services/agent/nodes/ClassifierNode');

// ========== 辅助函数 ==========

/** 创建标准分类列表 */
function createCategories() {
  return [
    { id: 'cat1', name: '技术问题', description: '编程、软件相关' },
    { id: 'cat2', name: '产品咨询', description: '功能、价格相关' },
    { id: 'cat3', name: '投诉建议', description: '服务质量反馈' }
  ];
}

/** 创建分类节点实例 */
function createNode(configOverrides = {}) {
  return new ClassifierNode({
    id: 'classifier-1',
    type: 'classifier',
    data: {
      config: {
        model: 'gpt-4',
        categories: createCategories(),
        background_knowledge: '这是一个AI客服系统',
        history_turns: 6,
        ...configOverrides
      }
    }
  });
}

// ========== 测试套件 ==========

describe('ClassifierNode - 问题分类节点', () => {

  // ========== getConfig() 测试 ==========
  describe('getConfig() - 配置读取', () => {

    test('新版data.config路径：应正常读取', () => {
      const node = createNode({ model: 'claude-3' });
      expect(node.getConfig('model')).toBe('claude-3');
    });

    test('旧版直接从data读取（兼容）', () => {
      const node = new ClassifierNode({
        id: 'c1', type: 'classifier',
        data: { model: 'gpt-3.5', categories: [] }  // 旧版格式
      });
      expect(node.getConfig('model')).toBe('gpt-3.5');
    });

    test('两者都没有：应返回默认值', () => {
      const node = new ClassifierNode({
        id: 'c1', type: 'classifier', data: {}
      });
      expect(node.getConfig('model', 'default-model')).toBe('default-model');
    });

    test('data.config优先于data', () => {
      const node = new ClassifierNode({
        id: 'c1', type: 'classifier',
        data: {
          model: '旧的',
          config: { model: '新的' }
        }
      });
      expect(node.getConfig('model')).toBe('新的');
    });
  });

  // ========== validate() 测试 ==========
  describe('validate() - 节点配置验证', () => {

    test('完整配置：应通过验证', () => {
      const node = createNode();
      const result = node.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('未选择模型：应报错', () => {
      const node = createNode({ model: null });
      const result = node.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('必须选择AI模型');
    });

    test('分类列表为空：应报错', () => {
      const node = createNode({ categories: [] });
      const result = node.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('至少需要定义一个分类'))).toBe(true);
    });

    test('分类超过100个：应报错', () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => ({
        id: `cat${i}`, name: `分类${i}`
      }));
      const node = createNode({ categories: tooMany });
      const result = node.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('不能超过100个'))).toBe(true);
    });

    test('分类缺少名称：应报错', () => {
      const node = createNode({
        categories: [
          { id: 'c1', name: '有名称' },
          { id: 'c2', name: '' }
        ]
      });
      const result = node.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('分类 2 缺少名称'))).toBe(true);
    });
  });

  // ========== buildSystemPrompt() 测试 ==========
  describe('buildSystemPrompt() - 系统提示词构建', () => {

    test('应包含所有分类名称和描述', () => {
      const node = createNode();
      const categories = createCategories();
      const prompt = node.buildSystemPrompt(categories, '背景知识');

      expect(prompt).toContain('技术问题');
      expect(prompt).toContain('编程、软件相关');
      expect(prompt).toContain('产品咨询');
      expect(prompt).toContain('投诉建议');
    });

    test('应包含背景知识', () => {
      const node = createNode();
      const prompt = node.buildSystemPrompt(createCategories(), 'AI客服系统背景');
      expect(prompt).toContain('AI客服系统背景');
    });

    test('无背景知识时不应包含背景知识段', () => {
      const node = createNode();
      const prompt = node.buildSystemPrompt(createCategories(), '');
      expect(prompt).not.toContain('【背景知识】');
    });

    test('应指明输出格式为数字', () => {
      const node = createNode();
      const prompt = node.buildSystemPrompt(createCategories(), '');
      expect(prompt).toContain('只输出一个数字');
    });
  });

  // ========== buildClassificationPrompt() 测试 ==========
  describe('buildClassificationPrompt() - 分类提示词构建', () => {

    test('应包含用户问题', () => {
      const node = createNode();
      const prompt = node.buildClassificationPrompt(
        '如何安装Python?', createCategories(), '', []
      );
      expect(prompt).toContain('如何安装Python?');
    });

    test('有历史消息时应包含对话历史', () => {
      const node = createNode();
      const messages = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮助你的？' }
      ];
      const prompt = node.buildClassificationPrompt(
        '我有个问题', createCategories(), '', messages
      );
      expect(prompt).toContain('对话历史');
      expect(prompt).toContain('你好');
    });

    test('无历史消息时不应包含历史段', () => {
      const node = createNode();
      const prompt = node.buildClassificationPrompt(
        '问题', createCategories(), '', []
      );
      expect(prompt).not.toContain('对话历史');
    });
  });

  // ========== parseClassificationResult() 测试 ==========
  describe('parseClassificationResult() - 分类结果解析', () => {

    const categories = createCategories();

    test('返回数字"2"：应匹配第二个分类', () => {
      const node = createNode();
      const result = node.parseClassificationResult('2', categories);

      expect(result.category_id).toBe('cat2');
      expect(result.category_name).toBe('产品咨询');
      expect(result.category_index).toBe(1);
      expect(result.confidence).toBe('high');
    });

    test('返回"1"：应匹配第一个分类', () => {
      const node = createNode();
      const result = node.parseClassificationResult('1', categories);

      expect(result.category_id).toBe('cat1');
      expect(result.category_name).toBe('技术问题');
    });

    test('返回带文字的数字"答案是3"：应提取数字3', () => {
      const node = createNode();
      const result = node.parseClassificationResult('答案是3', categories);

      expect(result.category_id).toBe('cat3');
      expect(result.category_name).toBe('投诉建议');
    });

    test('返回超出范围的数字"99"：应尝试模糊匹配', () => {
      const node = createNode();
      const result = node.parseClassificationResult('99', categories);

      // 无法数字匹配也无法模糊匹配，应默认第一个
      expect(result.category_index).toBe(0);
      expect(result.confidence).toBe('low');
    });

    test('返回分类名称文本：应模糊匹配', () => {
      const node = createNode();
      const result = node.parseClassificationResult(
        '这个属于技术问题类别', categories
      );

      expect(result.category_name).toBe('技术问题');
      expect(result.confidence).toBe('medium');
    });

    test('完全无法匹配：应返回第一个分类（低置信度）', () => {
      const node = createNode();
      const result = node.parseClassificationResult(
        '这是一段完全无关的文字', categories
      );

      expect(result.category_index).toBe(0);
      expect(result.confidence).toBe('low');
    });

    test('空响应：应返回默认分类', () => {
      const node = createNode();
      const result = node.parseClassificationResult('', categories);

      expect(result.category_index).toBe(0);
      expect(result.confidence).toBe('low');
    });
  });
});
