/**
 * 知识库节点 - 从知识库加载内容
 * v1.0 - 支持直接加载Wiki文档作为上下文
 * v1.1 - 修复validate返回格式
 * v1.2 - 修复配置读取路径（this.data.config）
 * 
 * 功能：
 * - 直接加载模式：将整个Wiki文档内容作为上下文传递给下游节点
 * - 支持多个知识库的内容合并
 * - 自动计算Token数量
 * 
 * 配置参数：
 * - source: 数据来源 'wiki'
 * - mode: 加载模式 'direct'（直接加载）
 * - wiki_ids: 选中的Wiki ID数组
 */

const BaseNode = require('./BaseNode');
const WikiItem = require('../../../models/WikiItem');
const { calculateTokens, formatTokenCount } = require('../../../utils/tokenCalculator');
const logger = require('../../../utils/logger');

class KnowledgeNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
    this.type = 'knowledge';
  }

  /**
   * 获取配置（兼容旧版和新版）
   * v1.2 新增：与LLMNode保持一致的配置读取方式
   * @param {string} key - 配置键名
   * @param {*} defaultValue - 默认值
   * @returns {*} 配置值
   */
  getConfig(key, defaultValue = undefined) {
    // 优先从 data.config 读取（新版）
    if (this.data && this.data.config && this.data.config[key] !== undefined) {
      return this.data.config[key];
    }
    // 兼容旧版直接从 data 读取
    if (this.data && this.data[key] !== undefined) {
      return this.data[key];
    }
    return defaultValue;
  }

  /**
   * 验证节点配置
   * v1.1 修复：返回 { valid: boolean, errors: string[] } 格式
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const source = this.getConfig('source');
    const mode = this.getConfig('mode');
    const wikiIds = this.getConfig('wiki_ids');
    const errors = [];
    
    // 如果配置了Wiki来源和直接加载模式，必须选择知识库
    if (source === 'wiki' && mode === 'direct') {
      if (!wikiIds || !Array.isArray(wikiIds) || wikiIds.length === 0) {
        errors.push('请至少选择一个知识库');
      }
    }
    
    // 如果没有配置source，使用默认值，不报错
    // 这样知识库节点可以作为可选节点存在
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 执行节点 - 加载知识库内容
   * v1.2 修复：使用getConfig方法读取配置
   * @param {Object} context - 执行上下文（包含用户信息等）
   * @param {number} userId - 用户ID
   * @param {Object} nodeTypeConfig - 节点类型配置
   * @returns {Object} - 包含知识库内容的输出
   */
  async execute(context = {}, userId, nodeTypeConfig) {
    // 使用getConfig方法读取配置
    const source = this.getConfig('source');
    const mode = this.getConfig('mode');
    const wikiIds = this.getConfig('wiki_ids');
    
    // 从context中获取用户信息（如果有的话）
    const groupId = context.groupId;
    const userRole = context.userRole;

    logger.info('知识库节点开始执行', {
      nodeId: this.id,
      source: source,
      mode: mode,
      wikiIds: wikiIds,
      dataConfig: this.data?.config  // 调试用
    });

    // 如果没有配置，返回空上下文（节点可选）
    if (!source || source !== 'wiki') {
      logger.info('知识库节点未配置数据源，跳过', { source });
      return {
        output: {
          knowledge_context: '',
          total_tokens: 0,
          wiki_count: 0
        },
        credits_used: 0
      };
    }

    // 如果没有选择知识库，返回空
    if (!wikiIds || !Array.isArray(wikiIds) || wikiIds.length === 0) {
      logger.info('知识库节点未选择知识库，跳过', { wikiIds });
      return {
        output: {
          knowledge_context: '',
          total_tokens: 0,
          wiki_count: 0
        },
        credits_used: 0
      };
    }

    // 直接加载模式
    if (mode === 'direct') {
      const result = await this.executeDirectLoad(wikiIds, userId, groupId, userRole);
      return {
        output: result,
        credits_used: 0  // 知识库加载不消耗积分
      };
    }

    // 其他模式暂不支持
    logger.warn('知识库节点不支持的加载模式', { mode: mode });
    return {
      output: {
        knowledge_context: '',
        total_tokens: 0,
        wiki_count: 0
      },
      credits_used: 0
    };
  }

  /**
   * 执行直接加载模式
   * @param {Array<number>} wikiIds - 要加载的Wiki ID列表
   * @param {number} userId - 用户ID
   * @param {number} groupId - 组ID
   * @param {string} userRole - 用户角色
   * @returns {Object} - 合并后的知识库内容
   */
  async executeDirectLoad(wikiIds, userId, groupId, userRole) {
    const loadedWikis = [];
    const contentParts = [];
    let totalTokens = 0;

    logger.info('开始直接加载知识库', { 
      wikiIds, 
      userId, 
      groupId, 
      userRole 
    });

    for (const wikiId of wikiIds) {
      try {
        // 获取知识库内容（会自动检查权限）
        const fullItem = await WikiItem.findById(wikiId, userId, groupId, userRole);
        
        if (!fullItem) {
          logger.warn('知识库不存在或无权访问，跳过', { wikiId, userId });
          continue;
        }

        if (!fullItem.content) {
          logger.warn('知识库内容为空，跳过', { wikiId });
          continue;
        }

        // 计算Token
        const tokens = calculateTokens(fullItem.content);
        totalTokens += tokens;

        // 格式化内容块
        const contentBlock = this.formatContentBlock(fullItem);
        contentParts.push(contentBlock);

        loadedWikis.push({
          id: fullItem.id,
          title: fullItem.title,
          tokens: tokens,
          tokens_display: formatTokenCount(tokens)
        });

        logger.info('成功加载知识库', {
          wikiId,
          title: fullItem.title,
          contentLength: fullItem.content.length,
          tokens
        });

      } catch (error) {
        logger.error('加载知识库失败', { wikiId, error: error.message });
        // 继续处理其他知识库
      }
    }

    // 合并所有内容
    const combinedContent = contentParts.join('\n\n');

    logger.info('知识库节点执行完成', {
      nodeId: this.id,
      loadedCount: loadedWikis.length,
      totalTokens,
      totalTokensDisplay: formatTokenCount(totalTokens),
      combinedContentLength: combinedContent.length
    });

    return {
      knowledge_context: combinedContent,
      total_tokens: totalTokens,
      total_tokens_display: formatTokenCount(totalTokens),
      wiki_count: loadedWikis.length,
      loaded_wikis: loadedWikis
    };
  }

  /**
   * 格式化单个知识库的内容块
   * @param {Object} wikiItem - 知识库对象
   * @returns {string} - 格式化后的内容
   */
  formatContentBlock(wikiItem) {
    const separator = '='.repeat(50);
    const header = `=== 知识库：${wikiItem.title} ===`;
    
    let content = `${separator}\n${header}\n${separator}\n\n`;
    content += wikiItem.content;
    
    // 如果有描述，添加到开头
    if (wikiItem.description) {
      content = `${separator}\n${header}\n【描述】${wikiItem.description}\n${separator}\n\n${wikiItem.content}`;
    }
    
    return content;
  }

  /**
   * 获取节点消耗的积分（知识库加载不消耗积分）
   */
  getCreditsPerExecution() {
    return 0;
  }
}

module.exports = KnowledgeNode;
