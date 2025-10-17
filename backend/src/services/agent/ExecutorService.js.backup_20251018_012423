/**
 * Agent工作流执行引擎
 * 负责工作流的编排、执行、积分管理和错误处理
 */

const NodeRegistry = require('./NodeRegistry');
const AgentWorkflow = require('../../models/AgentWorkflow');
const AgentExecution = require('../../models/AgentExecution');
const AgentNodeExecution = require('../../models/AgentNodeExecution');
const AgentNodeType = require('../../models/AgentNodeType');
const User = require('../../models/User');
const logger = require('../../utils/logger');

class ExecutorService {
  constructor() {
    this.maxExecutionTime = 10 * 60 * 1000; // 10分钟超时
  }

  /**
   * 执行工作流
   * @param {number} workflowId - 工作流ID
   * @param {number} userId - 用户ID
   * @param {Object} inputData - 输入数据
   * @returns {Promise<Object>} 执行结果
   */
  async executeWorkflow(workflowId, userId, inputData = {}) {
    const startTime = Date.now();
    let executionId = null;
    let preDeductedCredits = 0;
    let creditsRefunded = false;

    try {
      logger.info('开始执行工作流', { workflowId, userId, inputData });

      // 1. 加载工作流定义
      const workflow = await AgentWorkflow.findById(workflowId);
      if (!workflow) {
        throw new Error(`工作流不存在: ${workflowId}`);
      }

      // 2. 权限检查
      if (workflow.user_id !== userId) {
        const user = await User.findById(userId);
        if (user.role !== 'super_admin') {
          throw new Error('无权执行此工作流');
        }
      }

      // 3. 检查工作流是否已发布
      if (!workflow.is_published) {
        throw new Error('工作流未发布，无法执行');
      }

      // 4. 解析工作流数据
      let flowData;
      try {
        flowData = typeof workflow.flow_data === 'string' 
          ? JSON.parse(workflow.flow_data) 
          : workflow.flow_data;
      } catch (error) {
        throw new Error('工作流数据格式错误');
      }

      const { nodes = [], edges = [] } = flowData;

      if (nodes.length === 0) {
        throw new Error('工作流为空');
      }

      logger.info('工作流数据加载完成', {
        nodeCount: nodes.length,
        edgeCount: edges.length
      });

      // 5. 验证节点类型和预估积分
      const { nodeTypeMap, estimatedCredits } = await this.validateAndEstimateCredits(nodes);

      logger.info('积分预估完成', { estimatedCredits });

      // 6. 预扣积分
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('用户不存在');
      }

      if (estimatedCredits > 0) {
        if (!user.hasCredits(estimatedCredits)) {
          throw new Error(`积分不足，需要 ${estimatedCredits} 积分，当前余额 ${user.getCredits()}`);
        }

        // 预扣积分
        await user.consumeCredits(
          estimatedCredits,
          null,
          null,
          `工作流预扣: ${workflow.name}`,
          'agent_execution'
        );
        preDeductedCredits = estimatedCredits;
        logger.info('积分预扣成功', { userId, amount: estimatedCredits });
      }

      // 7. 创建执行记录
      executionId = await AgentExecution.create({
        workflow_id: workflowId,
        user_id: userId,
        status: 'running',
        input_data: inputData,
        estimated_credits: estimatedCredits
      });

      logger.info('执行记录创建成功', { executionId });

      // 8. 拓扑排序（检测环形依赖）
      const sortedNodes = this.topologicalSort(nodes, edges);

      logger.info('拓扑排序完成', { 
        executionOrder: sortedNodes.map(n => `${n.type}:${n.id}`)
      });

      // 9. 执行节点
      const context = {
        input: inputData,
        variables: {},
        userId,
        workflowId,
        executionId
      };

      let totalCreditsUsed = 0;
      let lastNodeOutput = null;

      for (const node of sortedNodes) {
        // 检查超时
        if (Date.now() - startTime > this.maxExecutionTime) {
          throw new Error('执行超时（10分钟）');
        }

        const nodeStartTime = Date.now();

        try {
          // 创建节点实例
          const nodeInstance = NodeRegistry.createInstance(node);
          if (!nodeInstance) {
            throw new Error(`无法创建节点实例: ${node.type}`);
          }

          // 验证节点配置
          const validation = nodeInstance.validate();
          if (!validation.valid) {
            throw new Error(`节点配置错误: ${validation.errors.join(', ')}`);
          }

          // 获取节点类型配置（积分消耗）
          const nodeTypeConfig = nodeTypeMap.get(node.type);

          logger.info('执行节点', {
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            creditsPerExecution: nodeTypeConfig.credits_per_execution
          });

          // 记录节点开始执行
          const nodeExecutionId = await AgentNodeExecution.create({
            execution_id: executionId,
            node_id: node.id,
            node_type: node.type,
            status: 'running',
            input_data: context.variables
          });

          // 执行节点
          const result = await nodeInstance.execute(context, userId, nodeTypeConfig);

          const nodeEndTime = Date.now();
          const duration = nodeEndTime - nodeStartTime;

          // 累计积分消耗
          const creditsUsed = result.credits_used || 0;
          totalCreditsUsed += creditsUsed;

          // 保存节点输出到上下文
          context.variables[node.id] = result.output;
          lastNodeOutput = result.output;

          // 更新节点执行记录
          await AgentNodeExecution.update(nodeExecutionId, {
            status: 'success',
            output_data: result.output,
            credits_used: creditsUsed,
            duration_ms: duration,
            completed_at: new Date()
          });

          logger.info('节点执行成功', {
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            creditsUsed,
            duration
          });

        } catch (error) {
          logger.error('节点执行失败', {
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            error: error.message
          });

          // 获取对象后使用 .id 属性
          const nodeExecution = await AgentNodeExecution.findByExecutionAndNode(executionId, node.id);
          if (nodeExecution && nodeExecution.id) {
            await AgentNodeExecution.update(nodeExecution.id, {
              status: 'failed',
              error_message: error.message
            });
          }

          throw error;
        }
      }

      // 10. 计算实际消耗和退款
      const creditsToRefund = Math.max(0, preDeductedCredits - totalCreditsUsed);

      if (creditsToRefund > 0) {
        // 退还多扣的积分
        await user.addCredits(
          creditsToRefund,
          `工作流退款: ${workflow.name}`,
          null,
          0
        );
        creditsRefunded = true;
        logger.info('退还多扣积分', { userId, amount: creditsToRefund });
      }

      // 11. 更新执行记录为成功（修正：使用 'success'）
      await AgentExecution.update(executionId, {
        status: 'success',
        output_data: lastNodeOutput,
        total_credits_used: totalCreditsUsed,
        completed_at: new Date()
      });

      const totalDuration = Date.now() - startTime;

      logger.info('工作流执行成功', {
        executionId,
        workflowId,
        userId,
        totalCreditsUsed,
        creditsRefunded: creditsToRefund,
        duration: totalDuration
      });

      return {
        success: true,
        executionId,
        output: lastNodeOutput,
        credits: {
          estimated: estimatedCredits,
          used: totalCreditsUsed,
          refunded: creditsToRefund
        },
        duration: totalDuration
      };

    } catch (error) {
      logger.error('工作流执行失败', {
        workflowId,
        userId,
        executionId,
        error: error.message,
        stack: error.stack
      });

      // 如果已经创建执行记录，更新为失败状态
      if (executionId) {
        await AgentExecution.update(executionId, {
          status: 'failed',
          error_message: error.message,
          completed_at: new Date()
        });
      }

      // 如果预扣了积分但未退款，则退还
      if (preDeductedCredits > 0 && !creditsRefunded) {
        try {
          const user = await User.findById(userId);
          await user.addCredits(
            preDeductedCredits,
            `工作流失败退款: ${error.message}`,
            null,
            0
          );
          logger.info('失败后退还积分', { userId, amount: preDeductedCredits });
        } catch (refundError) {
          logger.error('退款失败', { refundError: refundError.message });
        }
      }

      throw error;
    }
  }

  /**
   * 验证节点并估算积分消耗
   * @param {Array} nodes - 节点数组
   * @returns {Promise<Object>} { nodeTypeMap, estimatedCredits }
   */
  async validateAndEstimateCredits(nodes) {
    const nodeTypeMap = new Map();
    let estimatedCredits = 0;

    for (const node of nodes) {
      // 检查节点类型是否已注册
      if (!NodeRegistry.has(node.type)) {
        throw new Error(`未知节点类型: ${node.type}`);
      }

      // 从数据库获取节点类型配置（如果已缓存则跳过）
      if (!nodeTypeMap.has(node.type)) {
        const nodeTypeConfig = await AgentNodeType.findByTypeKey(node.type);
        if (!nodeTypeConfig) {
          throw new Error(`节点类型配置不存在: ${node.type}`);
        }

        if (!nodeTypeConfig.is_active) {
          throw new Error(`节点类型已禁用: ${node.type}`);
        }

        nodeTypeMap.set(node.type, nodeTypeConfig);

        // 累计积分
        estimatedCredits += nodeTypeConfig.credits_per_execution || 0;
      }
    }

    return { nodeTypeMap, estimatedCredits };
  }

  /**
   * 拓扑排序 - 确定节点执行顺序，检测环形依赖
   * @param {Array} nodes - 节点数组
   * @param {Array} edges - 连线数组
   * @returns {Array} 排序后的节点数组
   */
  topologicalSort(nodes, edges) {
    // 构建邻接表和入度表
    const adjList = new Map(); // node.id -> [target node ids]
    const inDegree = new Map(); // node.id -> count
    const nodeMap = new Map(); // node.id -> node object

    // 初始化
    nodes.forEach(node => {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      nodeMap.set(node.id, node);
    });

    // 构建图
    edges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;

      if (!adjList.has(source) || !adjList.has(target)) {
        throw new Error(`连线引用了不存在的节点: ${source} -> ${target}`);
      }

      adjList.get(source).push(target);
      inDegree.set(target, inDegree.get(target) + 1);
    });

    // Kahn算法
    const queue = [];
    const sorted = [];

    // 找到所有入度为0的节点（开始节点）
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
      }
    });

    if (queue.length === 0) {
      throw new Error('工作流必须有至少一个开始节点（无输入连线）');
    }

    // BFS排序
    while (queue.length > 0) {
      const currentId = queue.shift();
      sorted.push(nodeMap.get(currentId));

      // 处理所有邻居
      adjList.get(currentId).forEach(neighborId => {
        inDegree.set(neighborId, inDegree.get(neighborId) - 1);

        if (inDegree.get(neighborId) === 0) {
          queue.push(neighborId);
        }
      });
    }

    // 检测环形依赖
    if (sorted.length !== nodes.length) {
      throw new Error('工作流存在环形依赖，无法执行');
    }

    return sorted;
  }

  /**
   * 取消执行（预留）
   * @param {number} executionId - 执行ID
   * @param {number} userId - 用户ID
   */
  async cancelExecution(executionId, userId) {
    try {
      const execution = await AgentExecution.findById(executionId);
      
      if (!execution) {
        throw new Error('执行记录不存在');
      }

      if (execution.user_id !== userId) {
        throw new Error('无权取消此执行');
      }

      if (execution.status !== 'running') {
        throw new Error('只能取消正在运行的执行');
      }

      // 更新状态为已取消
      await AgentExecution.update(executionId, {
        status: 'cancelled',
        completed_at: new Date()
      });

      logger.info('执行已取消', { executionId, userId });

      return {
        success: true,
        message: '执行已取消'
      };
    } catch (error) {
      logger.error('取消执行失败', { executionId, userId, error: error.message });
      throw error;
    }
  }
}

// 导出单例
module.exports = new ExecutorService();
