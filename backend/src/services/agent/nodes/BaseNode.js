/**
 * Agent节点抽象基类
 * 所有节点类型都继承此基类
 */

const logger = require('../../../utils/logger');

class BaseNode {
  constructor(nodeData) {
    this.id = nodeData.id;
    this.type = nodeData.type;
    this.data = nodeData.data || {};
    this.position = nodeData.position;
  }

  /**
   * 执行节点 - 子类必须实现
   * @param {Object} context - 执行上下文（包含其他节点的输出）
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置（来自数据库）
   * @returns {Promise<Object>} 节点输出结果
   */
  async execute(context, userId, nodeTypeConfig) {
    throw new Error(`节点 ${this.type} 未实现 execute 方法`);
  }

  /**
   * 验证节点配置 - 子类可选实现
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    return { valid: true, errors: [] };
  }

  /**
   * 替换文本中的变量 {{nodeId.output}}
   * @param {string} text - 包含变量的文本
   * @param {Object} context - 执行上下文
   * @returns {string} 替换后的文本
   */
  replaceVariables(text, context) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // 匹配 {{nodeId}} 或 {{nodeId.path.to.value}}
    const variablePattern = /\{\{([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_.]+))?\}\}/g;

    return text.replace(variablePattern, (match, nodeId, path) => {
      try {
        // 获取节点输出
        const nodeOutput = context.variables[nodeId];

        if (!nodeOutput) {
          logger.warn('变量引用的节点不存在或无输出', { nodeId, match });
          return match; // 保持原样
        }

        // 如果没有指定路径，直接返回整个输出
        if (!path) {
          return typeof nodeOutput === 'object' ? JSON.stringify(nodeOutput) : String(nodeOutput);
        }

        // 解析嵌套路径（如 output.content）
        const keys = path.split('.');
        let value = nodeOutput;

        for (const key of keys) {
          if (value && typeof value === 'object' && key in value) {
            value = value[key];
          } else {
            logger.warn('变量路径不存在', { nodeId, path, match });
            return match; // 保持原样
          }
        }

        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      } catch (error) {
        logger.error('变量替换失败', { match, error: error.message });
        return match; // 保持原样
      }
    });
  }

  /**
   * 记录节点执行日志
   */
  log(level, message, data = {}) {
    logger[level](`[Node ${this.type}:${this.id}] ${message}`, data);
  }
}

module.exports = BaseNode;
