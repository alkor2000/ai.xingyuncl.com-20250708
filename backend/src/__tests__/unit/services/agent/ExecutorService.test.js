/**
 * ExecutorService - Agent工作流执行引擎单元测试
 * 
 * 测试范围：
 * - topologicalSort()              拓扑排序（Kahn算法、环检测、无效边）
 * - validateWorkflowConnections()  连接完整性验证（v2.4）
 * - shouldSkipNode()               条件分支跳过判断（v2.2）
 * - formatFinalOutput()            最终输出格式化
 * - validateAndEstimateCredits()   节点验证与积分预估
 * 
 * Mock策略：
 * - NodeRegistry、数据库模型全Mock
 * - 只测执行引擎的编排逻辑，不测实际AI调用
 */

// ========== Mock外部依赖 ==========

jest.mock('../../../../services/agent/NodeRegistry', () => ({
  has: jest.fn().mockReturnValue(true),
  createInstance: jest.fn(),
  get: jest.fn()
}));

jest.mock('../../../../models/AgentWorkflow', () => ({
  findById: jest.fn()
}));

jest.mock('../../../../models/AgentExecution', () => ({
  create: jest.fn(),
  update: jest.fn(),
  findById: jest.fn()
}));

jest.mock('../../../../models/AgentNodeExecution', () => ({
  create: jest.fn(),
  update: jest.fn(),
  findByExecutionAndNode: jest.fn()
}));

jest.mock('../../../../models/AgentNodeType', () => ({
  findByTypeKey: jest.fn()
}));

jest.mock('../../../../models/User', () => ({
  findById: jest.fn()
}));

jest.mock('../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块 ==========
const ExecutorService = require('../../../../services/agent/ExecutorService');
const NodeRegistry = require('../../../../services/agent/NodeRegistry');
const AgentNodeType = require('../../../../models/AgentNodeType');

// ========== 测试套件 ==========

describe('ExecutorService - Agent工作流执行引擎', () => {

  // ========== topologicalSort() 测试 ==========
  describe('topologicalSort() - 拓扑排序', () => {

    test('线性流程 start→llm→end：应按顺序排列', () => {
      const nodes = [
        { id: 'n1', type: 'start' },
        { id: 'n2', type: 'llm' },
        { id: 'n3', type: 'end' }
      ];
      const edges = [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' }
      ];

      const sorted = ExecutorService.topologicalSort(nodes, edges);

      expect(sorted.map(n => n.id)).toEqual(['n1', 'n2', 'n3']);
    });

    test('分支流程：start→knowledge+llm→end', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'k', type: 'knowledge' },
        { id: 'l', type: 'llm' },
        { id: 'e', type: 'end' }
      ];
      const edges = [
        { source: 's', target: 'k' },
        { source: 's', target: 'l' },
        { source: 'k', target: 'e' },
        { source: 'l', target: 'e' }
      ];

      const sorted = ExecutorService.topologicalSort(nodes, edges);

      expect(sorted[0].id).toBe('s');
      expect(sorted[sorted.length - 1].id).toBe('e');
      expect(sorted.length).toBe(4);
    });

    test('环形依赖（有入口但下游成环）：应抛出错误', () => {
      // start能进入，但b→c→d→b形成环
      const nodes = [
        { id: 'start', type: 'start' },
        { id: 'b', type: 'llm' },
        { id: 'c', type: 'llm' },
        { id: 'd', type: 'llm' }
      ];
      const edges = [
        { source: 'start', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
        { source: 'd', target: 'b' }  // 形成环 b→c→d→b
      ];

      expect(() => ExecutorService.topologicalSort(nodes, edges))
        .toThrow('环形依赖');
    });

    test('全部节点互相指向（无入度0节点）：应抛出错误', () => {
      const nodes = [
        { id: 'a', type: 'llm' },
        { id: 'b', type: 'llm' },
        { id: 'c', type: 'llm' }
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' }
      ];

      // 所有节点入度>0，queue为空，触发"无开始节点"错误
      expect(() => ExecutorService.topologicalSort(nodes, edges))
        .toThrow();
    });

    test('边引用不存在的节点：应抛出错误', () => {
      const nodes = [
        { id: 'n1', type: 'start' }
      ];
      const edges = [
        { source: 'n1', target: 'n999' }
      ];

      expect(() => ExecutorService.topologicalSort(nodes, edges))
        .toThrow('不存在的节点');
    });

    test('无边的单节点：应正常返回', () => {
      const nodes = [{ id: 'n1', type: 'start' }];
      const edges = [];

      const sorted = ExecutorService.topologicalSort(nodes, edges);
      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe('n1');
    });

    test('多个入度为0的节点：都应出现在排序结果中', () => {
      const nodes = [
        { id: 'a', type: 'start' },
        { id: 'b', type: 'knowledge' },
        { id: 'c', type: 'end' }
      ];
      const edges = [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' }
      ];

      const sorted = ExecutorService.topologicalSort(nodes, edges);
      expect(sorted).toHaveLength(3);
      expect(sorted[sorted.length - 1].id).toBe('c');
    });
  });

  // ========== validateWorkflowConnections() 测试 ==========
  describe('validateWorkflowConnections() - 连接完整性验证（v2.4）', () => {

    test('正常连接的工作流：应通过验证', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'l', type: 'llm', data: { label: 'AI对话' } },
        { id: 'e', type: 'end', data: { label: '输出' } }
      ];
      const edges = [
        { source: 's', target: 'l' },
        { source: 'l', target: 'e' }
      ];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .not.toThrow();
    });

    test('无开始节点：应抛出错误', () => {
      const nodes = [
        { id: 'l', type: 'llm' },
        { id: 'e', type: 'end' }
      ];
      const edges = [{ source: 'l', target: 'e' }];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .toThrow('必须包含一个开始节点');
    });

    test('多个开始节点：应抛出错误', () => {
      const nodes = [
        { id: 's1', type: 'start' },
        { id: 's2', type: 'start' },
        { id: 'e', type: 'end' }
      ];
      const edges = [
        { source: 's1', target: 'e' },
        { source: 's2', target: 'e' }
      ];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .toThrow('只能有一个开始节点');
    });

    test('LLM节点无上游连接：应抛出错误并指出节点名称', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'l', type: 'llm', data: { label: '翻译助手' } },
        { id: 'e', type: 'end', data: { label: '输出' } }
      ];
      const edges = [
        { source: 's', target: 'e' }
      ];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .toThrow('翻译助手');
    });

    test('end节点无上游连接：应抛出错误', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'l', type: 'llm', data: { label: 'AI' } },
        { id: 'e', type: 'end', data: { label: '输出' } }
      ];
      const edges = [
        { source: 's', target: 'l' }
      ];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .toThrow('结束节点');
    });

    test('knowledge节点无上游连接：应抛出错误', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'k', type: 'knowledge', data: { label: '知识库A' } },
        { id: 'e', type: 'end', data: { label: '输出' } }
      ];
      const edges = [
        { source: 's', target: 'e' }
      ];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .toThrow('知识检索');
    });

    test('多个节点同时缺少连接：错误信息应包含所有节点', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'l', type: 'llm', data: { label: 'AI1' } },
        { id: 'k', type: 'knowledge', data: { label: '知识库' } },
        { id: 'e', type: 'end', data: { label: '输出' } }
      ];
      const edges = [];

      try {
        ExecutorService.validateWorkflowConnections(nodes, edges);
        fail('应抛出错误');
      } catch (error) {
        expect(error.message).toContain('AI1');
        expect(error.message).toContain('知识库');
        expect(error.message).toContain('输出');
      }
    });

    test('start节点不需要上游连接：应通过', () => {
      const nodes = [
        { id: 's', type: 'start' },
        { id: 'e', type: 'end', data: { label: '输出' } }
      ];
      const edges = [
        { source: 's', target: 'e' }
      ];

      expect(() => ExecutorService.validateWorkflowConnections(nodes, edges))
        .not.toThrow();
    });
  });

  // ========== shouldSkipNode() 测试 ==========
  describe('shouldSkipNode() - 条件分支跳过判断（v2.2）', () => {

    test('无入边的节点：不应跳过', () => {
      const node = { id: 'n1', type: 'start' };
      const edges = [];
      const context = { skippedNodes: new Set(), branchDecisions: {}, variables: {} };

      expect(ExecutorService.shouldSkipNode(node, edges, context)).toBe(false);
    });

    test('上游节点已被跳过且无其他来源：应跳过', () => {
      const node = { id: 'n3', type: 'llm' };
      const edges = [{ source: 'n2', target: 'n3' }];
      const context = {
        skippedNodes: new Set(['n2']),
        branchDecisions: {},
        variables: {}
      };

      expect(ExecutorService.shouldSkipNode(node, edges, context)).toBe(true);
    });

    test('分类分支命中：不应跳过', () => {
      const node = { id: 'branch-a', type: 'llm' };
      const edges = [{
        source: 'classifier-1',
        target: 'branch-a',
        sourceHandle: 'output-cat1'
      }];
      const context = {
        skippedNodes: new Set(),
        branchDecisions: { 'classifier-1': 'output-cat1' },
        variables: { 'classifier-1': { category_id: 'cat1' } }
      };

      expect(ExecutorService.shouldSkipNode(node, edges, context)).toBe(false);
    });

    test('分类分支未命中：应跳过', () => {
      const node = { id: 'branch-b', type: 'llm' };
      const edges = [{
        source: 'classifier-1',
        target: 'branch-b',
        sourceHandle: 'output-cat2'
      }];
      const context = {
        skippedNodes: new Set(),
        branchDecisions: { 'classifier-1': 'output-cat1' },
        variables: { 'classifier-1': { category_id: 'cat1' } }
      };

      expect(ExecutorService.shouldSkipNode(node, edges, context)).toBe(true);
    });

    test('上游节点有输出且无分支条件：不应跳过', () => {
      const node = { id: 'n2', type: 'llm' };
      const edges = [{ source: 'n1', target: 'n2' }];
      const context = {
        skippedNodes: new Set(),
        branchDecisions: {},
        variables: { 'n1': { content: '你好' } }
      };

      expect(ExecutorService.shouldSkipNode(node, edges, context)).toBe(false);
    });
  });

  // ========== formatFinalOutput() 测试 ==========
  describe('formatFinalOutput() - 最终输出格式化', () => {

    test('null输出：应返回 { result: null }', () => {
      expect(ExecutorService.formatFinalOutput(null)).toEqual({ result: null });
    });

    test('undefined输出：应返回 { result: null }', () => {
      expect(ExecutorService.formatFinalOutput(undefined)).toEqual({ result: null });
    });

    test('字符串输出：应包装为 { result, type }', () => {
      const result = ExecutorService.formatFinalOutput('Hello World');
      expect(result.result).toBe('Hello World');
      expect(result.type).toBe('string');
    });

    test('数字输出：应包装为 { result, type }', () => {
      const result = ExecutorService.formatFinalOutput(42);
      expect(result.result).toBe(42);
      expect(result.type).toBe('number');
    });

    test('含output字段的对象：应提取output', () => {
      const result = ExecutorService.formatFinalOutput({
        output: '这是AI回复的内容'
      });
      expect(result.result).toBe('这是AI回复的内容');
      expect(result.type).toBe('text');
    });

    test('含content字段的对象：应提取content', () => {
      const result = ExecutorService.formatFinalOutput({
        content: 'LLM响应内容'
      });
      expect(result.result).toBe('LLM响应内容');
      expect(result.type).toBe('llm_response');
    });

    test('普通对象（无output/content）：应原样返回', () => {
      const obj = { key: 'value', num: 123 };
      expect(ExecutorService.formatFinalOutput(obj)).toEqual(obj);
    });

    test('output是嵌套对象：应返回内层对象', () => {
      const inner = { data: [1, 2, 3], status: 'ok' };
      const result = ExecutorService.formatFinalOutput({ output: inner });
      expect(result).toEqual(inner);
    });
  });

  // ========== validateAndEstimateCredits() 测试 ==========
  describe('validateAndEstimateCredits() - 节点验证与积分预估', () => {

    test('所有节点类型有效：应返回积分总和', async () => {
      NodeRegistry.has.mockReturnValue(true);
      AgentNodeType.findByTypeKey
        .mockResolvedValueOnce({ type_key: 'start', credits_per_execution: 0, is_active: true })
        .mockResolvedValueOnce({ type_key: 'llm', credits_per_execution: 10, is_active: true })
        .mockResolvedValueOnce({ type_key: 'end', credits_per_execution: 0, is_active: true });

      const nodes = [
        { id: 's', type: 'start' },
        { id: 'l', type: 'llm' },
        { id: 'e', type: 'end' }
      ];

      const { estimatedCredits } = await ExecutorService.validateAndEstimateCredits(nodes);
      expect(estimatedCredits).toBe(10);
    });

    test('多个LLM节点：积分应累加', async () => {
      NodeRegistry.has.mockReturnValue(true);
      AgentNodeType.findByTypeKey
        .mockResolvedValueOnce({ type_key: 'start', credits_per_execution: 0, is_active: true })
        .mockResolvedValueOnce({ type_key: 'llm', credits_per_execution: 10, is_active: true });

      const nodes = [
        { id: 's', type: 'start' },
        { id: 'l1', type: 'llm' },
        { id: 'l2', type: 'llm' }
      ];

      const { estimatedCredits } = await ExecutorService.validateAndEstimateCredits(nodes);
      expect(estimatedCredits).toBe(20);
    });

    test('未知节点类型：应抛出错误', async () => {
      NodeRegistry.has.mockImplementation(type => type !== 'unknown_type');

      const nodes = [
        { id: 'n1', type: 'unknown_type' }
      ];

      await expect(ExecutorService.validateAndEstimateCredits(nodes))
        .rejects.toThrow('未知节点类型');
    });

    test('节点类型已禁用：应抛出错误', async () => {
      NodeRegistry.has.mockReturnValue(true);
      AgentNodeType.findByTypeKey.mockResolvedValue({
        type_key: 'llm', credits_per_execution: 10, is_active: false
      });

      const nodes = [{ id: 'l', type: 'llm' }];

      await expect(ExecutorService.validateAndEstimateCredits(nodes))
        .rejects.toThrow('节点类型已禁用');
    });

    test('节点类型配置不存在：应使用默认值不报错', async () => {
      NodeRegistry.has.mockReturnValue(true);
      AgentNodeType.findByTypeKey.mockResolvedValue(null);

      const nodes = [{ id: 'x', type: 'custom' }];

      const { estimatedCredits } = await ExecutorService.validateAndEstimateCredits(nodes);
      expect(estimatedCredits).toBe(0);
    });
  });
});
