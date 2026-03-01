/**
 * Agent工作流执行引擎
 * v2.1 - 修复output_data JSON格式问题
 * v2.2 - 支持条件分支执行（问题分类节点多输出）
 * v2.3 - P0修复：积分预估按节点数量累加 + groupId/userRole传入context
 * 负责工作流的编排、执行、积分管理和错误处理
 * 支持节点间数据传递和上下游连接
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
   * v2.2 - 支持条件分支执行
   * v2.3 - 修复：接收并传递用户上下文(groupId, userRole)到context
   * @param {number} workflowId - 工作流ID
   * @param {number} userId - 用户ID
   * @param {Object} inputData - 输入数据
   * @param {Object} options - 可选参数 { groupId, userRole }
   * @returns {Promise<Object>} 执行结果
   */
  async executeWorkflow(workflowId, userId, inputData = {}, options = {}) {
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

      // 5. 验证工作流连接性
      this.validateWorkflowConnections(nodes, edges);

      // 6. 验证节点类型和预估积分
      // v2.3 修复：按节点数量累加积分，而非按类型只算一次
      const { nodeTypeMap, estimatedCredits } = await this.validateAndEstimateCredits(nodes);

      logger.info('积分预估完成', { estimatedCredits });

      // 7. 预扣积分
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

      // 8. 创建执行记录
      executionId = await AgentExecution.create({
        workflow_id: workflowId,
        user_id: userId,
        status: 'running',
        input_data: inputData,
        estimated_credits: estimatedCredits
      });

      logger.info('执行记录创建成功', { executionId });

      // 9. 拓扑排序（检测环形依赖）
      const sortedNodes = this.topologicalSort(nodes, edges);

      logger.info('拓扑排序完成', { 
        executionOrder: sortedNodes.map(n => `${n.type}:${n.id}`)
      });

      // 10. 执行节点（v2.2: 支持条件分支）
      // v2.3 修复：将 groupId 和 userRole 加入 context，供知识库节点等使用
      const context = {
        input: inputData,
        variables: {},
        userId,
        groupId: options.groupId || null,      // v2.3 新增：用户组ID
        userRole: options.userRole || null,     // v2.3 新增：用户角色
        workflowId,
        executionId,
        // v2.2: 记录分支决策，用于条件执行
        branchDecisions: {},  // { classifierNodeId: 'output-cat-xxx' }
        skippedNodes: new Set()  // 被跳过的节点ID集合
      };

      let totalCreditsUsed = 0;
      let lastNodeOutput = null;

      for (const node of sortedNodes) {
        // 检查超时
        if (Date.now() - startTime > this.maxExecutionTime) {
          throw new Error('执行超时（10分钟）');
        }

        // v2.2: 检查节点是否应该被跳过（条件分支）
        if (this.shouldSkipNode(node, edges, context)) {
          logger.info('跳过节点（条件分支未命中）', {
            executionId,
            nodeId: node.id,
            nodeType: node.type
          });
          context.skippedNodes.add(node.id);
          continue;
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

          // 查找上游节点输出并传递
          const incomingEdges = edges.filter(e => e.target === node.id);
          
          if (incomingEdges.length > 0) {
            // 有上游节点，获取上游输出（优先选择未被跳过的上游）
            let upstreamOutput = null;
            for (const edge of incomingEdges) {
              if (!context.skippedNodes.has(edge.source)) {
                upstreamOutput = context.variables[edge.source];
                if (upstreamOutput) {
                  logger.info('传递上游节点输出', {
                    currentNode: node.id,
                    upstreamNode: edge.source,
                    hasOutput: !!upstreamOutput
                  });
                  break;
                }
              }
            }
            context.upstreamOutput = upstreamOutput;
          } else {
            context.upstreamOutput = null;
          }

          logger.info('执行节点', {
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            creditsPerExecution: nodeTypeConfig?.credits_per_execution || 0,
            hasUpstream: !!context.upstreamOutput
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

          // v2.2: 如果是分类节点，记录分支决策
          if (node.type === 'classifier' && result.output) {
            const categoryId = result.output.category_id;
            if (categoryId) {
              // 记录选中的输出端口
              context.branchDecisions[node.id] = `output-${categoryId}`;
              logger.info('记录分类分支决策', {
                nodeId: node.id,
                categoryId,
                selectedOutput: `output-${categoryId}`
              });
            }
          }

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

      // 11. 计算实际消耗和退款
      const creditsToRefund = Math.max(0, preDeductedCredits - totalCreditsUsed);

      if (creditsToRefund > 0) {
        await user.addCredits(
          creditsToRefund,
          `工作流退款: ${workflow.name}`,
          null,
          0
        );
        creditsRefunded = true;
        logger.info('退还多扣积分', { userId, amount: creditsToRefund });
      }

      // 12. 格式化最终输出
      const finalOutput = this.formatFinalOutput(lastNodeOutput);

      // 13. 更新执行记录为成功
      await AgentExecution.update(executionId, {
        status: 'success',
        output_data: finalOutput,
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
        duration: totalDuration,
        skippedNodes: Array.from(context.skippedNodes)
      });

      return {
        success: true,
        executionId,
        output: finalOutput,
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

      if (executionId) {
        await AgentExecution.update(executionId, {
          status: 'failed',
          error_message: error.message,
          output_data: { error: error.message },
          completed_at: new Date()
        });
      }

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
   * v2.2 新增：判断节点是否应该被跳过
   * 基于条件分支决策判断
   * @param {Object} node - 当前节点
   * @param {Array} edges - 所有边
   * @param {Object} context - 执行上下文
   * @returns {boolean} 是否跳过
   */
  shouldSkipNode(node, edges, context) {
    // 查找所有指向此节点的边
    const incomingEdges = edges.filter(e => e.target === node.id);
    
    if (incomingEdges.length === 0) {
      // 没有上游连接（开始节点），不跳过
      return false;
    }

    // 检查每条入边
    for (const edge of incomingEdges) {
      const sourceNodeId = edge.source;
      const sourceHandle = edge.sourceHandle;
      
      // 如果上游节点已被跳过，当前节点也应跳过
      if (context.skippedNodes.has(sourceNodeId)) {
        continue; // 检查其他入边
      }
      
      // 检查是否是分类节点的条件分支
      if (sourceHandle && sourceHandle.startsWith('output-')) {
        // 这是一个条件分支边
        const branchDecision = context.branchDecisions[sourceNodeId];
        
        if (branchDecision) {
          // 有分支决策
          if (branchDecision === sourceHandle) {
            // 命中分支，不跳过
            logger.info('条件分支命中', {
              targetNode: node.id,
              sourceNode: sourceNodeId,
              sourceHandle,
              decision: branchDecision
            });
            return false;
          } else {
            // 未命中此分支，继续检查其他入边
            logger.info('条件分支未命中', {
              targetNode: node.id,
              sourceNode: sourceNodeId,
              sourceHandle,
              decision: branchDecision
            });
            continue;
          }
        }
      }
      
      // 普通边（非条件分支），如果上游已执行，不跳过
      if (context.variables[sourceNodeId] !== undefined) {
        return false;
      }
    }
    
    // 所有入边都未命中或上游被跳过
    return true;
  }

  /**
   * 格式化最终输出
   */
  formatFinalOutput(output) {
    if (output === null || output === undefined) {
      return { result: null };
    }
    
    if (typeof output === 'object') {
      if (output.output !== undefined) {
        const innerOutput = output.output;
        if (typeof innerOutput === 'string') {
          return { result: innerOutput, type: 'text' };
        }
        return typeof innerOutput === 'object' ? innerOutput : { result: innerOutput };
      }
      
      if (output.content !== undefined) {
        return { result: output.content, type: 'llm_response' };
      }
      
      return output;
    }
    
    return { result: output, type: typeof output };
  }

  /**
   * 验证工作流连接性
   */
  validateWorkflowConnections(nodes, edges) {
    const startNodes = nodes.filter(n => n.type === 'start');
    if (startNodes.length === 0) {
      throw new Error('工作流必须包含一个开始节点');
    }
    
    if (startNodes.length > 1) {
      throw new Error('工作流只能有一个开始节点');
    }

    for (const node of nodes) {
      if (node.type === 'llm') {
        const incomingEdges = edges.filter(e => e.target === node.id);
        
        if (incomingEdges.length === 0) {
          throw new Error(`LLM节点 "${node.data?.label || node.id}" 必须连接上游节点`);
        }
      }
    }
  }

  /**
   * 验证节点并估算积分消耗
   * v2.3 修复：按每个节点累加积分，而非按节点类型只算一次
   * 例如：工作流有2个LLM节点（每个10积分），应预估20积分而非10积分
   */
  async validateAndEstimateCredits(nodes) {
    const nodeTypeMap = new Map();
    let estimatedCredits = 0;

    for (const node of nodes) {
      if (!NodeRegistry.has(node.type)) {
        throw new Error(`未知节点类型: ${node.type}`);
      }

      // 获取或缓存节点类型配置（只查一次数据库，缓存到Map）
      if (!nodeTypeMap.has(node.type)) {
        const nodeTypeConfig = await AgentNodeType.findByTypeKey(node.type);
        
        if (!nodeTypeConfig) {
          const defaultConfig = {
            type_key: node.type,
            display_name: node.type,
            credits_per_execution: 0,
            is_active: true
          };
          nodeTypeMap.set(node.type, defaultConfig);
          logger.warn('节点类型配置不存在，使用默认值', { type: node.type });
        } else {
          if (!nodeTypeConfig.is_active) {
            throw new Error(`节点类型已禁用: ${node.type}`);
          }
          nodeTypeMap.set(node.type, nodeTypeConfig);
        }
      }

      // v2.3 修复：每个节点都累加积分（移到if外面）
      // 之前的bug：只在第一次遇到某类型时累加，导致同类型多节点漏算
      const cachedConfig = nodeTypeMap.get(node.type);
      estimatedCredits += cachedConfig?.credits_per_execution || 0;
    }

    return { nodeTypeMap, estimatedCredits };
  }

  /**
   * 拓扑排序
   */
  topologicalSort(nodes, edges) {
    const adjList = new Map();
    const inDegree = new Map();
    const nodeMap = new Map();

    nodes.forEach(node => {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      nodeMap.set(node.id, node);
    });

    edges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;

      if (!adjList.has(source) || !adjList.has(target)) {
        throw new Error(`连线引用了不存在的节点: ${source} -> ${target}`);
      }

      adjList.get(source).push(target);
      inDegree.set(target, inDegree.get(target) + 1);
    });

    const queue = [];
    const sorted = [];

    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
      }
    });

    if (queue.length === 0) {
      throw new Error('工作流必须有至少一个开始节点（无输入连线）');
    }

    while (queue.length > 0) {
      const currentId = queue.shift();
      sorted.push(nodeMap.get(currentId));

      adjList.get(currentId).forEach(neighborId => {
        inDegree.set(neighborId, inDegree.get(neighborId) - 1);

        if (inDegree.get(neighborId) === 0) {
          queue.push(neighborId);
        }
      });
    }

    if (sorted.length !== nodes.length) {
      throw new Error('工作流存在环形依赖，无法执行');
    }

    return sorted;
  }

  /**
   * 取消执行
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

      await AgentExecution.update(executionId, {
        status: 'cancelled',
        output_data: { cancelled: true, message: '用户取消' },
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

module.exports = new ExecutorService();
