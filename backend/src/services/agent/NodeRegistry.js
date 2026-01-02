/**
 * 节点注册表
 * 管理所有可用的节点类型
 * v2.0 - 新增KnowledgeNode知识库节点
 * v2.1 - 修复createInstance方法兼容性
 * v2.2 - 新增ClassifierNode问题分类节点
 */

const StartNode = require('./nodes/StartNode');
const LLMNode = require('./nodes/LLMNode');
const EndNode = require('./nodes/EndNode');
const KnowledgeNode = require('./nodes/KnowledgeNode');
const ClassifierNode = require('./nodes/ClassifierNode');
const logger = require('../../utils/logger');

class NodeRegistry {
  constructor() {
    this.nodes = new Map();
    this.registerBuiltinNodes();
  }

  /**
   * 注册内置节点
   */
  registerBuiltinNodes() {
    // 开始节点
    this.register('start', StartNode);
    
    // LLM对话节点
    this.register('llm', LLMNode);
    
    // 结束节点（保留兼容）
    this.register('end', EndNode);
    
    // 知识库节点（v2.0新增）
    this.register('knowledge', KnowledgeNode);
    
    // 问题分类节点（v2.2新增）
    this.register('classifier', ClassifierNode);
    
    logger.info('节点注册表初始化完成', {
      registeredNodes: Array.from(this.nodes.keys())
    });
  }

  /**
   * 注册节点类型
   * @param {string} type - 节点类型标识
   * @param {Class} NodeClass - 节点类
   */
  register(type, NodeClass) {
    this.nodes.set(type, NodeClass);
    logger.info(`注册节点类型: ${type}`);
  }

  /**
   * 获取节点类
   * @param {string} type - 节点类型标识
   * @returns {Class|null} - 节点类
   */
  get(type) {
    return this.nodes.get(type) || null;
  }

  /**
   * 检查节点类型是否存在
   * @param {string} type - 节点类型标识
   * @returns {boolean}
   */
  has(type) {
    return this.nodes.has(type);
  }

  /**
   * 创建节点实例
   * v2.1 修复：兼容ExecutorService的调用方式
   * 支持两种调用方式：
   *   1. createInstance(nodeObject) - 传入完整的node对象
   *   2. createInstance(type, nodeData) - 分别传入类型和数据
   * 
   * @param {string|Object} typeOrNode - 节点类型标识 或 完整的节点对象
   * @param {Object} [nodeData] - 节点数据（当第一个参数是类型时使用）
   * @returns {Object|null} - 节点实例
   */
  createInstance(typeOrNode, nodeData) {
    let type;
    let data;
    
    // 判断调用方式
    if (typeof typeOrNode === 'object' && typeOrNode !== null) {
      // 方式1: 传入完整的node对象
      type = typeOrNode.type;
      data = typeOrNode;
    } else {
      // 方式2: 分别传入类型和数据
      type = typeOrNode;
      data = nodeData || {};
    }
    
    const NodeClass = this.get(type);
    if (!NodeClass) {
      logger.warn(`未知的节点类型: ${type}`);
      return null;
    }
    
    return new NodeClass(data);
  }

  /**
   * 获取所有已注册的节点类型
   * @returns {string[]}
   */
  getRegisteredTypes() {
    return Array.from(this.nodes.keys());
  }
}

// 单例模式
const instance = new NodeRegistry();

module.exports = instance;
