/**
 * 节点注册表（工厂模式）
 * 管理所有节点类型的注册和实例化
 */

const StartNode = require('./nodes/StartNode');
const LLMNode = require('./nodes/LLMNode');
const EndNode = require('./nodes/EndNode');
const logger = require('../../utils/logger');

class NodeRegistry {
  constructor() {
    // 节点类型映射表
    this.nodeTypes = new Map();
    
    // 注册内置节点类型
    this.register('start', StartNode);
    this.register('llm', LLMNode);
    this.register('end', EndNode);
    
    logger.info('节点注册表初始化完成', {
      registeredTypes: Array.from(this.nodeTypes.keys())
    });
  }

  /**
   * 注册节点类型
   * @param {string} type - 节点类型标识
   * @param {Class} NodeClass - 节点类
   */
  register(type, NodeClass) {
    if (this.nodeTypes.has(type)) {
      logger.warn('节点类型已存在，将被覆盖', { type });
    }
    
    this.nodeTypes.set(type, NodeClass);
    logger.debug('注册节点类型', { type, className: NodeClass.name });
  }

  /**
   * 获取节点类
   * @param {string} type - 节点类型标识
   * @returns {Class|null} 节点类
   */
  get(type) {
    const NodeClass = this.nodeTypes.get(type);
    
    if (!NodeClass) {
      logger.error('未找到节点类型', { type, availableTypes: Array.from(this.nodeTypes.keys()) });
      return null;
    }
    
    return NodeClass;
  }

  /**
   * 创建节点实例
   * @param {Object} nodeData - 节点数据
   * @returns {BaseNode|null} 节点实例
   */
  createInstance(nodeData) {
    const NodeClass = this.get(nodeData.type);
    
    if (!NodeClass) {
      logger.error('无法创建节点实例：未知类型', { 
        nodeId: nodeData.id, 
        type: nodeData.type 
      });
      return null;
    }
    
    try {
      const instance = new NodeClass(nodeData);
      logger.debug('创建节点实例', { 
        nodeId: nodeData.id, 
        type: nodeData.type,
        className: NodeClass.name
      });
      return instance;
    } catch (error) {
      logger.error('创建节点实例失败', { 
        nodeId: nodeData.id, 
        type: nodeData.type,
        error: error.message
      });
      return null;
    }
  }

  /**
   * 获取所有已注册的节点类型
   * @returns {Array<string>} 节点类型列表
   */
  getRegisteredTypes() {
    return Array.from(this.nodeTypes.keys());
  }

  /**
   * 检查节点类型是否已注册
   * @param {string} type - 节点类型标识
   * @returns {boolean}
   */
  has(type) {
    return this.nodeTypes.has(type);
  }
}

// 导出单例
module.exports = new NodeRegistry();
