/**
 * 开始节点
 * 工作流的入口，接收用户输入参数
 */

const BaseNode = require('./BaseNode');

class StartNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
  }

  /**
   * 执行开始节点
   * @param {Object} context - 执行上下文
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置
   * @returns {Promise<Object>} 返回用户输入的数据
   */
  async execute(context, userId, nodeTypeConfig) {
    this.log('info', '开始节点执行', { userId, inputData: context.input });

    // 开始节点不消耗积分
    // 直接返回输入数据
    return {
      success: true,
      output: context.input || {},
      message: '工作流已启动'
    };
  }

  /**
   * 验证开始节点配置
   */
  validate() {
    // 开始节点不需要特殊配置
    return { valid: true, errors: [] };
  }
}

module.exports = StartNode;
