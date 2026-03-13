/**
 * BaseNode - Agent节点基类单元测试
 * 
 * 测试范围：
 * - constructor()        构造函数（字段初始化）
 * - execute()            抽象方法（子类未实现时报错）
 * - validate()           默认验证（返回valid:true）
 * - replaceVariables()   变量替换（简单引用、嵌套路径、不存在的变量）
 * 
 * Mock策略：无外部依赖，纯逻辑测试
 */

jest.mock('../../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const BaseNode = require('../../../../../services/agent/nodes/BaseNode');

describe('BaseNode - Agent节点基类', () => {

  // ========== constructor 测试 ==========
  describe('constructor() - 构造函数', () => {

    test('应正确初始化字段', () => {
      const node = new BaseNode({
        id: 'node-1',
        type: 'test',
        data: { label: '测试节点' },
        position: { x: 100, y: 200 }
      });

      expect(node.id).toBe('node-1');
      expect(node.type).toBe('test');
      expect(node.data).toEqual({ label: '测试节点' });
      expect(node.position).toEqual({ x: 100, y: 200 });
    });

    test('data为空时应默认为空对象', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      expect(node.data).toEqual({});
    });
  });

  // ========== execute() 测试 ==========
  describe('execute() - 抽象方法', () => {

    test('未被子类实现时应抛出错误', async () => {
      const node = new BaseNode({ id: 'n1', type: 'base' });

      await expect(node.execute({}, 1, {}))
        .rejects.toThrow('未实现 execute 方法');
    });
  });

  // ========== validate() 测试 ==========
  describe('validate() - 默认验证', () => {

    test('默认应返回 valid:true', () => {
      const node = new BaseNode({ id: 'n1', type: 'test' });
      const result = node.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ========== replaceVariables() 测试 ==========
  describe('replaceVariables() - 变量替换', () => {

    test('简单变量 {{nodeId}}：应替换为节点输出', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = {
        variables: { 'node1': '你好世界' }
      };

      const result = node.replaceVariables('消息: {{node1}}', context);
      expect(result).toBe('消息: 你好世界');
    });

    test('嵌套路径 {{nodeId.output.content}}：应解析到深层值', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = {
        variables: {
          'llm1': { output: { content: 'AI回复内容' } }
        }
      };

      const result = node.replaceVariables('结果: {{llm1.output.content}}', context);
      expect(result).toBe('结果: AI回复内容');
    });

    test('变量不存在：应保持原样 {{unknown}}', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = { variables: {} };

      const result = node.replaceVariables('值: {{unknown}}', context);
      expect(result).toBe('值: {{unknown}}');
    });

    test('路径不存在：应保持原样', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = {
        variables: { 'node1': { a: 1 } }
      };

      const result = node.replaceVariables('{{node1.b.c}}', context);
      expect(result).toBe('{{node1.b.c}}');
    });

    test('对象输出无路径：应JSON序列化', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = {
        variables: { 'data': { key: 'value' } }
      };

      const result = node.replaceVariables('{{data}}', context);
      expect(result).toBe('{"key":"value"}');
    });

    test('null/undefined输入：应原样返回', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = { variables: {} };

      expect(node.replaceVariables(null, context)).toBeNull();
      expect(node.replaceVariables(undefined, context)).toBeUndefined();
      expect(node.replaceVariables('', context)).toBe('');
    });

    test('数字类型输入（非字符串）：应原样返回', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = { variables: {} };

      expect(node.replaceVariables(123, context)).toBe(123);
    });

    test('多个变量同时替换', () => {
      const node = new BaseNode({ id: 'n', type: 't' });
      const context = {
        variables: { 'a': 'Hello', 'b': 'World' }
      };

      const result = node.replaceVariables('{{a}} {{b}}!', context);
      expect(result).toBe('Hello World!');
    });
  });
});
