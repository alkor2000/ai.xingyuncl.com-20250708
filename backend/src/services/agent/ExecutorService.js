/**
 * Agent工作流执行引擎
 * v2.5 - 移除"未发布"执行限制
 * v2.6 - 新增executeWorkflowStream流式执行：
 *   中间节点非流式执行，最后一个LLM节点流式输出SSE
 *   复用executeWorkflow的全部逻辑（验证、积分、拓扑排序、分支）
 */

const NodeRegistry = require('./NodeRegistry');
const AgentWorkflow = require('../../models/AgentWorkflow');
const AgentExecution = require('../../models/AgentExecution');
const AgentNodeExecution = require('../../models/AgentNodeExecution');
const AgentNodeType = require('../../models/AgentNodeType');
const AICallHelper = require('./nodes/AICallHelper');
const AIModel = require('../../models/AIModel');
const User = require('../../models/User');
const logger = require('../../utils/logger');

class ExecutorService {
  constructor() {
    this.maxExecutionTime = 10 * 60 * 1000; // 10分钟超时
  }

  /**
   * 执行工作流（非流式，原有逻辑不变）
   */
  async executeWorkflow(workflowId, userId, inputData = {}, options = {}) {
    const startTime = Date.now();
    let executionId = null;
    let preDeductedCredits = 0;
    let creditsRefunded = false;

    try {
      logger.info('开始执行工作流', { workflowId, userId, inputData });

      const workflow = await AgentWorkflow.findById(workflowId);
      if (!workflow) throw new Error(`工作流不存在: ${workflowId}`);

      if (workflow.user_id !== userId) {
        const user = await User.findById(userId);
        if (user.role !== 'super_admin') throw new Error('无权执行此工作流');
      }

      let flowData;
      try {
        flowData = typeof workflow.flow_data === 'string' ? JSON.parse(workflow.flow_data) : workflow.flow_data;
      } catch (error) { throw new Error('工作流数据格式错误'); }

      const { nodes = [], edges = [] } = flowData;
      if (nodes.length === 0) throw new Error('工作流为空');

      this.validateWorkflowConnections(nodes, edges);

      const { nodeTypeMap, estimatedCredits } = await this.validateAndEstimateCredits(nodes);

      const user = await User.findById(userId);
      if (!user) throw new Error('用户不存在');

      if (estimatedCredits > 0) {
        if (!user.hasCredits(estimatedCredits)) {
          throw new Error(`积分不足，需要 ${estimatedCredits} 积分，当前余额 ${user.getCredits()}`);
        }
        await user.consumeCredits(estimatedCredits, null, null, `工作流预扣: ${workflow.name}`, 'agent_execution');
        preDeductedCredits = estimatedCredits;
      }

      executionId = await AgentExecution.create({
        workflow_id: workflowId, user_id: userId, status: 'running',
        input_data: inputData, estimated_credits: estimatedCredits
      });

      const sortedNodes = this.topologicalSort(nodes, edges);

      const context = {
        input: inputData, variables: {}, userId,
        groupId: options.groupId || null, userRole: options.userRole || null,
        workflowId, executionId, branchDecisions: {}, skippedNodes: new Set()
      };

      let totalCreditsUsed = 0;
      let lastNodeOutput = null;

      for (const node of sortedNodes) {
        if (Date.now() - startTime > this.maxExecutionTime) throw new Error('执行超时（10分钟）');

        if (this.shouldSkipNode(node, edges, context)) {
          context.skippedNodes.add(node.id);
          continue;
        }

        const nodeStartTime = Date.now();

        try {
          const nodeInstance = NodeRegistry.createInstance(node);
          if (!nodeInstance) throw new Error(`无法创建节点实例: ${node.type}`);

          const validation = nodeInstance.validate();
          if (!validation.valid) throw new Error(`节点配置错误: ${validation.errors.join(', ')}`);

          const nodeTypeConfig = nodeTypeMap.get(node.type);

          const incomingEdges = edges.filter(e => e.target === node.id);
          if (incomingEdges.length > 0) {
            let upstreamOutput = null;
            for (const edge of incomingEdges) {
              if (!context.skippedNodes.has(edge.source)) {
                upstreamOutput = context.variables[edge.source];
                if (upstreamOutput) break;
              }
            }
            context.upstreamOutput = upstreamOutput;
          } else {
            context.upstreamOutput = null;
          }

          const nodeExecutionId = await AgentNodeExecution.create({
            execution_id: executionId, node_id: node.id, node_type: node.type,
            status: 'running', input_data: context.variables
          });

          const result = await nodeInstance.execute(context, userId, nodeTypeConfig);

          const duration = Date.now() - nodeStartTime;
          const creditsUsed = result.credits_used || 0;
          totalCreditsUsed += creditsUsed;

          context.variables[node.id] = result.output;
          lastNodeOutput = result.output;

          if (node.type === 'classifier' && result.output) {
            const categoryId = result.output.category_id;
            if (categoryId) context.branchDecisions[node.id] = `output-${categoryId}`;
          }

          await AgentNodeExecution.update(nodeExecutionId, {
            status: 'success', output_data: result.output,
            credits_used: creditsUsed, duration_ms: duration, completed_at: new Date()
          });

        } catch (error) {
          const nodeExecution = await AgentNodeExecution.findByExecutionAndNode(executionId, node.id);
          if (nodeExecution && nodeExecution.id) {
            await AgentNodeExecution.update(nodeExecution.id, { status: 'failed', error_message: error.message });
          }
          throw error;
        }
      }

      const creditsToRefund = Math.max(0, preDeductedCredits - totalCreditsUsed);
      if (creditsToRefund > 0) {
        await user.addCredits(creditsToRefund, `工作流退款: ${workflow.name}`, null, 0);
        creditsRefunded = true;
      }

      const finalOutput = this.formatFinalOutput(lastNodeOutput);

      await AgentExecution.update(executionId, {
        status: 'success', output_data: finalOutput,
        total_credits_used: totalCreditsUsed, completed_at: new Date()
      });

      return {
        success: true, executionId, output: finalOutput,
        credits: { estimated: estimatedCredits, used: totalCreditsUsed, refunded: creditsToRefund },
        duration: Date.now() - startTime
      };

    } catch (error) {
      logger.error('工作流执行失败', { workflowId, userId, executionId, error: error.message });

      if (executionId) {
        await AgentExecution.update(executionId, {
          status: 'failed', error_message: error.message,
          output_data: { error: error.message }, completed_at: new Date()
        });
      }

      if (preDeductedCredits > 0 && !creditsRefunded) {
        try {
          const user = await User.findById(userId);
          await user.addCredits(preDeductedCredits, `工作流失败退款: ${error.message}`, null, 0);
        } catch (refundError) { logger.error('退款失败', { refundError: refundError.message }); }
      }

      throw error;
    }
  }

  /**
   * v2.6: 流式执行工作流
   * 
   * 核心思路：
   * - 中间节点（知识库、分类、非最后的LLM）正常非流式执行
   * - 找到拓扑排序中最后一个LLM节点，用流式API调用
   * - 最后的LLM节点之前的所有步骤在SSE的init事件中告知客户端"处理中"
   * - 最后的LLM节点切换为流式，实时推送delta给客户端
   * 
   * @param {Object} res - Express响应对象（已设置SSE头）
   * @param {number} workflowId
   * @param {number} userId
   * @param {Object} inputData
   * @param {Object} options - { groupId, userRole }
   * @returns {Promise<Object>} 执行结果
   */
  async executeWorkflowStream(res, workflowId, userId, inputData = {}, options = {}) {
    const startTime = Date.now();
    let executionId = null;
    let preDeductedCredits = 0;
    let creditsRefunded = false;

    try {
      /* ========== 1-9: 与非流式完全相同的准备逻辑 ========== */
      const workflow = await AgentWorkflow.findById(workflowId);
      if (!workflow) throw new Error(`工作流不存在: ${workflowId}`);

      if (workflow.user_id !== userId) {
        const user = await User.findById(userId);
        if (user.role !== 'super_admin') throw new Error('无权执行此工作流');
      }

      let flowData;
      try {
        flowData = typeof workflow.flow_data === 'string' ? JSON.parse(workflow.flow_data) : workflow.flow_data;
      } catch (error) { throw new Error('工作流数据格式错误'); }

      const { nodes = [], edges = [] } = flowData;
      if (nodes.length === 0) throw new Error('工作流为空');

      this.validateWorkflowConnections(nodes, edges);
      const { nodeTypeMap, estimatedCredits } = await this.validateAndEstimateCredits(nodes);

      const user = await User.findById(userId);
      if (!user) throw new Error('用户不存在');

      if (estimatedCredits > 0) {
        if (!user.hasCredits(estimatedCredits)) {
          throw new Error(`积分不足，需要 ${estimatedCredits} 积分，当前余额 ${user.getCredits()}`);
        }
        await user.consumeCredits(estimatedCredits, null, null, `工作流预扣: ${workflow.name}`, 'agent_execution');
        preDeductedCredits = estimatedCredits;
      }

      executionId = await AgentExecution.create({
        workflow_id: workflowId, user_id: userId, status: 'running',
        input_data: inputData, estimated_credits: estimatedCredits
      });

      const sortedNodes = this.topologicalSort(nodes, edges);

      /* v2.6.1: 动态判断最后一个LLM节点
       * 不能预先确定，因为分类分支会导致部分节点被跳过
       * 策略：先执行所有非LLM节点+中间LLM节点（非流式），
       *       运行时记录最后一个实际执行的LLM节点作为流式候选
       * 
       * 实际做法：用两遍扫描
       *   第一遍：正常执行所有节点（非流式），记录结果
       *   但这样就没有流式了...
       * 
       * 更好的做法：在执行循环中，判断当前LLM节点之后
       *   是否还有其他未跳过的LLM节点，如果没有就走流式
       */
      logger.info('流式执行工作流', {
        workflowId, executionId,
        nodeCount: sortedNodes.length
      });

      /* 发送init事件，告知客户端开始处理 */
      AICallHelper.sendSSE(res, 'init', {
        execution_id: executionId,
        workflow_name: workflow.name,
        node_count: sortedNodes.length
      });

      /* ========== 10: 按拓扑排序执行节点 ========== */
      const context = {
        input: inputData, variables: {}, userId,
        groupId: options.groupId || null, userRole: options.userRole || null,
        workflowId, executionId, branchDecisions: {}, skippedNodes: new Set()
      };

      let totalCreditsUsed = 0;
      let lastNodeOutput = null;
      let streamedContent = ''; /* 流式节点的完整输出 */

      for (const node of sortedNodes) {
        if (Date.now() - startTime > this.maxExecutionTime) throw new Error('执行超时（10分钟）');

        if (this.shouldSkipNode(node, edges, context)) {
          context.skippedNodes.add(node.id);
          continue;
        }

        const nodeStartTime = Date.now();

        /* 传递上游输出 */
        const incomingEdges = edges.filter(e => e.target === node.id);
        if (incomingEdges.length > 0) {
          let upstreamOutput = null;
          for (const edge of incomingEdges) {
            if (!context.skippedNodes.has(edge.source)) {
              upstreamOutput = context.variables[edge.source];
              if (upstreamOutput) break;
            }
          }
          context.upstreamOutput = upstreamOutput;
        } else {
          context.upstreamOutput = null;
        }

        /* v2.6.1: 动态判断是否为最后一个会执行的LLM节点
         * 检查当前节点之后的排序中是否还有未跳过的LLM节点
         * 如果没有，当前节点就是最后一个LLM → 走流式 */
        let isLastLLM = false;
        if (node.type === 'llm') {
          const currentIndex = sortedNodes.indexOf(node);
          let hasLaterLLM = false;
          for (let j = currentIndex + 1; j < sortedNodes.length; j++) {
            const laterNode = sortedNodes[j];
            if (laterNode.type === 'llm' && !context.skippedNodes.has(laterNode.id)) {
              /* 还需要检查这个后续LLM节点是否会被跳过 */
              if (!this.shouldSkipNode(laterNode, edges, context)) {
                hasLaterLLM = true;
                break;
              }
            }
          }
          isLastLLM = !hasLaterLLM;
          if (isLastLLM) {
            logger.info('动态确定最后LLM节点', { nodeId: node.id });
          }
        }

        if (isLastLLM) {
          /* ====== 最后一个LLM节点：流式执行 ====== */
          logger.info('最后LLM节点进入流式执行', { nodeId: node.id, executionId });

          /* 通知客户端即将开始流式输出 */
          AICallHelper.sendSSE(res, 'stream_start', { node_id: node.id });

          try {
            const nodeInstance = NodeRegistry.createInstance(node);
            if (!nodeInstance) throw new Error(`无法创建节点实例: ${node.type}`);
            const validation = nodeInstance.validate();
            if (!validation.valid) throw new Error(`节点配置错误: ${validation.errors.join(', ')}`);

            const nodeTypeConfig = nodeTypeMap.get(node.type);

            /* 构建LLM节点的messages（复用LLMNode的逻辑） */
            const modelName = nodeInstance.getConfig('model') || nodeInstance.getConfig('model_name');
            if (!modelName) throw new Error('未选择AI模型');

            const model = await AIModel.findByName(modelName);
            if (!model) throw new Error(`AI模型不存在: ${modelName}`);
            if (!model.is_active) throw new Error(`AI模型已禁用: ${model.display_name}`);

            /* 构建消息数组（从LLMNode.execute中提取的逻辑） */
            const llmMessages = this._buildLLMMessages(nodeInstance, context);
            const temperature = parseFloat(nodeInstance.getConfig('temperature', 0.7));
            const maxTokens = parseInt(nodeInstance.getConfig('max_tokens', 2000));

            /* 流式调用AI */
            streamedContent = await AICallHelper.callAIStream(res, model, llmMessages, {
              temperature, max_tokens: maxTokens
            });

            const duration = Date.now() - nodeStartTime;
            const creditsUsed = nodeTypeConfig?.credits_per_execution || 0;
            totalCreditsUsed += creditsUsed;

            /* 保存节点输出到上下文 */
            const nodeOutput = {
              content: streamedContent,
              model: model.name,
              display_name: model.display_name,
              tokens_used: AICallHelper.estimateTokens(streamedContent)
            };
            context.variables[node.id] = nodeOutput;
            lastNodeOutput = nodeOutput;

            /* 记录节点执行 */
            const nodeExecutionId = await AgentNodeExecution.create({
              execution_id: executionId, node_id: node.id, node_type: node.type,
              status: 'success', input_data: {}, output_data: nodeOutput,
              credits_used: creditsUsed, duration_ms: duration, completed_at: new Date()
            });

          } catch (error) {
            logger.error('流式LLM节点执行失败', { nodeId: node.id, error: error.message });
            throw error;
          }

        } else {
          /* ====== 非最后LLM节点：正常非流式执行 ====== */
          try {
            const nodeInstance = NodeRegistry.createInstance(node);
            if (!nodeInstance) throw new Error(`无法创建节点实例: ${node.type}`);
            const validation = nodeInstance.validate();
            if (!validation.valid) throw new Error(`节点配置错误: ${validation.errors.join(', ')}`);

            const nodeTypeConfig = nodeTypeMap.get(node.type);

            /* 发送节点执行进度 */
            AICallHelper.sendSSE(res, 'progress', {
              node_id: node.id, node_type: node.type,
              message: `正在执行: ${node.data?.label || node.type}`
            });

            const nodeExecutionId = await AgentNodeExecution.create({
              execution_id: executionId, node_id: node.id, node_type: node.type,
              status: 'running', input_data: context.variables
            });

            const result = await nodeInstance.execute(context, userId, nodeTypeConfig);

            const duration = Date.now() - nodeStartTime;
            const creditsUsed = result.credits_used || 0;
            totalCreditsUsed += creditsUsed;

            context.variables[node.id] = result.output;
            lastNodeOutput = result.output;

            if (node.type === 'classifier' && result.output) {
              const categoryId = result.output.category_id;
              if (categoryId) context.branchDecisions[node.id] = `output-${categoryId}`;
            }

            await AgentNodeExecution.update(nodeExecutionId, {
              status: 'success', output_data: result.output,
              credits_used: creditsUsed, duration_ms: duration, completed_at: new Date()
            });

          } catch (error) {
            const nodeExecution = await AgentNodeExecution.findByExecutionAndNode(executionId, node.id);
            if (nodeExecution && nodeExecution.id) {
              await AgentNodeExecution.update(nodeExecution.id, { status: 'failed', error_message: error.message });
            }
            throw error;
          }
        }
      }

      /* ========== 11-13: 积分退款和完成记录 ========== */
      const creditsToRefund = Math.max(0, preDeductedCredits - totalCreditsUsed);
      if (creditsToRefund > 0) {
        await user.addCredits(creditsToRefund, `工作流退款: ${workflow.name}`, null, 0);
        creditsRefunded = true;
      }

      const finalOutput = this.formatFinalOutput(lastNodeOutput);

      await AgentExecution.update(executionId, {
        status: 'success', output_data: finalOutput,
        total_credits_used: totalCreditsUsed, completed_at: new Date()
      });

      const totalDuration = Date.now() - startTime;

      logger.info('流式工作流执行成功', {
        executionId, workflowId, totalCreditsUsed, duration: totalDuration
      });

      return {
        success: true, executionId, output: finalOutput,
        streamedContent,
        credits: { estimated: estimatedCredits, used: totalCreditsUsed, refunded: creditsToRefund },
        duration: totalDuration
      };

    } catch (error) {
      logger.error('流式工作流执行失败', { workflowId, userId, executionId, error: error.message });

      if (executionId) {
        await AgentExecution.update(executionId, {
          status: 'failed', error_message: error.message,
          output_data: { error: error.message }, completed_at: new Date()
        });
      }

      if (preDeductedCredits > 0 && !creditsRefunded) {
        try {
          const user = await User.findById(userId);
          await user.addCredits(preDeductedCredits, `工作流失败退款: ${error.message}`, null, 0);
        } catch (refundError) { logger.error('退款失败', { refundError: refundError.message }); }
      }

      throw error;
    }
  }

  /**
   * v2.6: 从LLMNode的execute逻辑中提取消息构建
   * 将LLMNode实例的配置转化为messages数组，供流式调用
   */
  _buildLLMMessages(nodeInstance, context) {
    const messages = [];

    /* 系统提示词 */
    const systemPromptTemplate = nodeInstance.getConfig('system_prompt', '');
    if (systemPromptTemplate) {
      const systemPrompt = nodeInstance.replaceVariables(systemPromptTemplate, context);
      messages.push({ role: 'system', content: systemPrompt });
    }

    /* 历史消息 */
    const historyTurns = parseInt(nodeInstance.getConfig('history_turns', 10));
    const inputMessages = context.input?.messages || [];
    if (historyTurns > 0 && inputMessages.length > 0) {
      const messagesToKeep = historyTurns * 2;
      const recentMessages = inputMessages.slice(-messagesToKeep);
      messages.push(...recentMessages);
    }

    /* 当前用户消息（多级优先级，与LLMNode.execute一致） */
    let currentUserMessage;
    const userPromptTemplate = nodeInstance.getConfig('user_prompt') || nodeInstance.getConfig('prompt');

    if (userPromptTemplate) {
      currentUserMessage = nodeInstance.replaceVariables(userPromptTemplate, context);
    } else if (context.upstreamOutput && nodeInstance.isKnowledgeOutput(context.upstreamOutput)) {
      const knowledgeContext = context.upstreamOutput.knowledge_context || '';
      const originalQuery = context.input?.query || '';
      currentUserMessage = nodeInstance.buildKnowledgePrompt(knowledgeContext, originalQuery);
    } else if (context.upstreamOutput) {
      currentUserMessage = nodeInstance.extractUpstreamContent(context.upstreamOutput);
    } else if (context.input?.query) {
      currentUserMessage = context.input.query;
    } else if (context.input) {
      currentUserMessage = JSON.stringify(context.input);
    } else {
      throw new Error('无法获取用户输入');
    }

    messages.push({ role: 'user', content: currentUserMessage });

    return messages;
  }

  /**
   * 判断节点是否应该被跳过（条件分支）
   */
  shouldSkipNode(node, edges, context) {
    const incomingEdges = edges.filter(e => e.target === node.id);
    if (incomingEdges.length === 0) return false;

    for (const edge of incomingEdges) {
      const sourceNodeId = edge.source;
      const sourceHandle = edge.sourceHandle;
      
      if (context.skippedNodes.has(sourceNodeId)) continue;
      
      if (sourceHandle && sourceHandle.startsWith('output-')) {
        const branchDecision = context.branchDecisions[sourceNodeId];
        if (branchDecision) {
          if (branchDecision === sourceHandle) return false;
          else continue;
        }
      }
      
      if (context.variables[sourceNodeId] !== undefined) return false;
    }
    
    return true;
  }

  /**
   * 格式化最终输出
   */
  formatFinalOutput(output) {
    if (output === null || output === undefined) return { result: null };
    if (typeof output === 'object') {
      if (output.output !== undefined) {
        const innerOutput = output.output;
        if (typeof innerOutput === 'string') return { result: innerOutput, type: 'text' };
        return typeof innerOutput === 'object' ? innerOutput : { result: innerOutput };
      }
      if (output.content !== undefined) return { result: output.content, type: 'llm_response' };
      return output;
    }
    return { result: output, type: typeof output };
  }

  /**
   * 验证工作流连接完整性
   */
  validateWorkflowConnections(nodes, edges) {
    const startNodes = nodes.filter(n => n.type === 'start');
    if (startNodes.length === 0) throw new Error('工作流必须包含一个开始节点');
    if (startNodes.length > 1) throw new Error('工作流只能有一个开始节点');

    const disconnectedNodes = [];
    for (const node of nodes) {
      if (node.type === 'start') continue;
      const incomingEdges = edges.filter(e => e.target === node.id);
      if (incomingEdges.length === 0) {
        const nodeName = node.data?.label || node.data?.config?.label || node.type;
        const typeNames = { llm: 'AI模型', knowledge: '知识检索', classifier: '问题分类', end: '结束' };
        disconnectedNodes.push(`${typeNames[node.type] || node.type}节点「${nodeName}」`);
      }
    }
    if (disconnectedNodes.length > 0) {
      throw new Error(`以下节点缺少上游连接，请用连线将它们连接到工作流中：${disconnectedNodes.join('、')}`);
    }
  }

  /**
   * 验证节点并估算积分消耗
   */
  async validateAndEstimateCredits(nodes) {
    const nodeTypeMap = new Map();
    let estimatedCredits = 0;

    for (const node of nodes) {
      if (!NodeRegistry.has(node.type)) throw new Error(`未知节点类型: ${node.type}`);

      if (!nodeTypeMap.has(node.type)) {
        const nodeTypeConfig = await AgentNodeType.findByTypeKey(node.type);
        if (!nodeTypeConfig) {
          nodeTypeMap.set(node.type, { type_key: node.type, display_name: node.type, credits_per_execution: 0, is_active: true });
        } else {
          if (!nodeTypeConfig.is_active) throw new Error(`节点类型已禁用: ${node.type}`);
          nodeTypeMap.set(node.type, nodeTypeConfig);
        }
      }

      estimatedCredits += nodeTypeMap.get(node.type)?.credits_per_execution || 0;
    }

    return { nodeTypeMap, estimatedCredits };
  }

  /**
   * 拓扑排序（Kahn算法）
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
      if (!adjList.has(edge.source) || !adjList.has(edge.target)) {
        throw new Error(`连线引用了不存在的节点: ${edge.source} -> ${edge.target}`);
      }
      adjList.get(edge.source).push(edge.target);
      inDegree.set(edge.target, inDegree.get(edge.target) + 1);
    });

    const queue = [];
    const sorted = [];

    inDegree.forEach((degree, nodeId) => { if (degree === 0) queue.push(nodeId); });
    if (queue.length === 0) throw new Error('工作流必须有至少一个开始节点');

    while (queue.length > 0) {
      const currentId = queue.shift();
      sorted.push(nodeMap.get(currentId));
      adjList.get(currentId).forEach(neighborId => {
        inDegree.set(neighborId, inDegree.get(neighborId) - 1);
        if (inDegree.get(neighborId) === 0) queue.push(neighborId);
      });
    }

    if (sorted.length !== nodes.length) throw new Error('工作流存在环形依赖，无法执行');
    return sorted;
  }

  /**
   * 取消执行
   */
  async cancelExecution(executionId, userId) {
    try {
      const execution = await AgentExecution.findById(executionId);
      if (!execution) throw new Error('执行记录不存在');
      if (execution.user_id !== userId) throw new Error('无权取消此执行');
      if (execution.status !== 'running') throw new Error('只能取消正在运行的执行');

      await AgentExecution.update(executionId, {
        status: 'cancelled', output_data: { cancelled: true, message: '用户取消' }, completed_at: new Date()
      });
      return { success: true, message: '执行已取消' };
    } catch (error) {
      logger.error('取消执行失败', { executionId, userId, error: error.message });
      throw error;
    }
  }
}

module.exports = new ExecutorService();
