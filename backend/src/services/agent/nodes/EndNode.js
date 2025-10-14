/**
 * 结束节点
 * 工作流的出口，输出最终结果
 */

const BaseNode = require('./BaseNode');

class EndNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
  }

  /**
   * 执行结束节点
   * @param {Object} context - 执行上下文
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置
   * @returns {Promise<Object>} 返回最终输出
   */
  async execute(context, userId, nodeTypeConfig) {
    this.log('info', '结束节点执行', { userId });

    // 获取配置的输出格式
    const outputFormat = this.data.output_format || 'text';

    // 获取上一个节点的输出（假设只有一个输入）
    const inputNodeIds = Object.keys(context.variables).filter(id => id !== this.id);
    const lastNodeId = inputNodeIds[inputNodeIds.length - 1];
    const lastNodeOutput = context.variables[lastNodeId];

    let formattedOutput;

    switch (outputFormat) {
      case 'json':
        formattedOutput = typeof lastNodeOutput === 'object' 
          ? lastNodeOutput 
          : { result: lastNodeOutput };
        break;

      case 'markdown':
        formattedOutput = typeof lastNodeOutput === 'object'
          ? `\`\`\`json\n${JSON.stringify(lastNodeOutput, null, 2)}\n\`\`\``
          : String(lastNodeOutput);
        break;

      case 'text':
      default:
        formattedOutput = typeof lastNodeOutput === 'object'
          ? JSON.stringify(lastNodeOutput)
          : String(lastNodeOutput);
        break;
    }

    return {
      success: true,
      output: formattedOutput,
      format: outputFormat,
      message: '工作流执行完成'
    };
  }

  /**
   * 验证结束节点配置
   */
  validate() {
    const validFormats = ['text', 'json', 'markdown'];
    const outputFormat = this.data.output_format || 'text';

    if (!validFormats.includes(outputFormat)) {
      return {
        valid: false,
        errors: [`无效的输出格式: ${outputFormat}，支持的格式: ${validFormats.join(', ')}`]
      };
    }

    return { valid: true, errors: [] };
  }
}

module.exports = EndNode;
