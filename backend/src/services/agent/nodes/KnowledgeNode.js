/**
 * 知识库节点 - 支持直接加载和RAG检索两种模式
 * 
 * 模式说明：
 * - direct: 直接加载Wiki全部内容作为上下文（适合小文档）
 * - rag: 语义检索TOP-K相关片段作为上下文（适合大文档）
 * - auto: 自动选择（有向量索引用RAG，否则直接加载）
 * 
 * 配置参数：
 * - source: 'wiki'
 * - mode: 'direct' | 'rag' | 'auto'
 * - wiki_ids: 选中的Wiki ID数组
 * - top_k: RAG检索返回数量（默认5）
 */

const BaseNode = require('./BaseNode');
const WikiItem = require('../../../models/WikiItem');
const RAGService = require('../../ragService');
const { calculateTokens, formatTokenCount } = require('../../../utils/tokenCalculator');
const logger = require('../../../utils/logger');

class KnowledgeNode extends BaseNode {
  constructor(nodeData) {
    super(nodeData);
    this.type = 'knowledge';
  }

  /**
   * 获取配置（兼容新旧版）
   */
  getConfig(key, defaultValue = undefined) {
    if (this.data?.config?.[key] !== undefined) return this.data.config[key];
    if (this.data?.[key] !== undefined) return this.data[key];
    return defaultValue;
  }

  /**
   * 验证节点配置
   */
  validate() {
    const source = this.getConfig('source');
    const mode = this.getConfig('mode');
    const wikiIds = this.getConfig('wiki_ids');
    const errors = [];

    if (source === 'wiki' && (mode === 'direct' || mode === 'rag' || mode === 'auto')) {
      if (!wikiIds || !Array.isArray(wikiIds) || wikiIds.length === 0) {
        errors.push('请至少选择一个知识库');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 执行节点 - 加载或检索知识库内容
   */
  async execute(context = {}, userId, nodeTypeConfig) {
    const source = this.getConfig('source');
    const mode = this.getConfig('mode', 'auto');
    const wikiIds = this.getConfig('wiki_ids');
    const topK = this.getConfig('top_k', 5);
    const groupId = context.groupId;
    const userRole = context.userRole;

    logger.info('知识库节点开始执行', { nodeId: this.id, source, mode, wikiIds });

    /* 未配置数据源 */
    if (!source || source !== 'wiki' || !wikiIds || wikiIds.length === 0) {
      return { output: { knowledge_context: '', total_tokens: 0, wiki_count: 0 }, credits_used: 0 };
    }

    /* 获取用户查询（从上游输入或context） */
    const query = context.input?.query || context.upstreamOutput?.content || '';

    /* 根据模式选择加载方式 */
    if (mode === 'rag') {
      return await this.executeRAG(wikiIds, query, topK, userId, groupId, userRole);
    } else if (mode === 'direct') {
      return await this.executeDirect(wikiIds, userId, groupId, userRole);
    } else {
      /* auto模式：检查是否有向量索引 */
      return await this.executeAuto(wikiIds, query, topK, userId, groupId, userRole);
    }
  }

  /**
   * RAG检索模式
   */
  async executeRAG(wikiIds, query, topK, userId, groupId, userRole) {
    try {
      if (!query) {
        logger.warn('RAG模式但无查询文本，回退到直接加载');
        return await this.executeDirect(wikiIds, userId, groupId, userRole);
      }

      const results = await RAGService.search(wikiIds, query, topK);

      if (results.length === 0) {
        logger.warn('RAG检索无结果，回退到直接加载');
        return await this.executeDirect(wikiIds, userId, groupId, userRole);
      }

      const context = RAGService.formatAsContext(results);
      const totalTokens = calculateTokens(context);

      logger.info('RAG检索完成', {
        nodeId: this.id, resultCount: results.length,
        totalTokens, topSimilarity: results[0]?.similarity?.toFixed(4)
      });

      return {
        output: {
          knowledge_context: context,
          total_tokens: totalTokens,
          total_tokens_display: formatTokenCount(totalTokens),
          wiki_count: wikiIds.length,
          mode: 'rag',
          result_count: results.length
        },
        credits_used: 0
      };
    } catch (error) {
      logger.error('RAG检索失败，回退到直接加载:', error.message);
      return await this.executeDirect(wikiIds, userId, groupId, userRole);
    }
  }

  /**
   * 直接加载模式（原有逻辑）
   */
  async executeDirect(wikiIds, userId, groupId, userRole) {
    const contentParts = [];
    const loadedWikis = [];
    let totalTokens = 0;

    for (const wikiId of wikiIds) {
      try {
        const fullItem = await WikiItem.findById(wikiId, userId, groupId, userRole);
        if (!fullItem || !fullItem.content) continue;

        const tokens = calculateTokens(fullItem.content);
        totalTokens += tokens;
        contentParts.push(this.formatContentBlock(fullItem));
        loadedWikis.push({ id: fullItem.id, title: fullItem.title, tokens, tokens_display: formatTokenCount(tokens) });
      } catch (error) {
        logger.error('加载知识库失败', { wikiId, error: error.message });
      }
    }

    return {
      output: {
        knowledge_context: contentParts.join('\n\n'),
        total_tokens: totalTokens,
        total_tokens_display: formatTokenCount(totalTokens),
        wiki_count: loadedWikis.length,
        loaded_wikis: loadedWikis,
        mode: 'direct'
      },
      credits_used: 0
    };
  }

  /**
   * 自动模式：有索引用RAG，否则直接加载
   */
  async executeAuto(wikiIds, query, topK, userId, groupId, userRole) {
    try {
      const dbConnection = require('../../../database/connection');
      const placeholders = wikiIds.map(() => '?').join(',');
      const sql = `SELECT id, rag_enabled, index_status, chunk_count FROM wiki_items WHERE id IN (${placeholders})`;
      const { rows } = await dbConnection.query(sql, wikiIds);

      /* 检查是否有任何知识库有可用的向量索引 */
      const hasRAG = rows.some(r => r.rag_enabled && r.index_status === 'completed' && r.chunk_count > 0);

      if (hasRAG && query) {
        /* 只对有索引的知识库用RAG */
        const ragWikiIds = rows.filter(r => r.rag_enabled && r.index_status === 'completed').map(r => r.id);
        const directWikiIds = wikiIds.filter(id => !ragWikiIds.includes(id));

        let ragResult = { output: { knowledge_context: '', total_tokens: 0 }, credits_used: 0 };
        let directResult = { output: { knowledge_context: '', total_tokens: 0 }, credits_used: 0 };

        if (ragWikiIds.length > 0) {
          ragResult = await this.executeRAG(ragWikiIds, query, topK, userId, groupId, userRole);
        }
        if (directWikiIds.length > 0) {
          directResult = await this.executeDirect(directWikiIds, userId, groupId, userRole);
        }

        /* 合并结果 */
        const combinedContext = [ragResult.output.knowledge_context, directResult.output.knowledge_context]
          .filter(Boolean).join('\n\n');
        const combinedTokens = (ragResult.output.total_tokens || 0) + (directResult.output.total_tokens || 0);

        return {
          output: {
            knowledge_context: combinedContext,
            total_tokens: combinedTokens,
            total_tokens_display: formatTokenCount(combinedTokens),
            wiki_count: wikiIds.length,
            mode: 'auto(rag+direct)'
          },
          credits_used: 0
        };
      }

      /* 没有索引，全部直接加载 */
      return await this.executeDirect(wikiIds, userId, groupId, userRole);
    } catch (error) {
      logger.error('Auto模式失败，回退直接加载:', error.message);
      return await this.executeDirect(wikiIds, userId, groupId, userRole);
    }
  }

  /**
   * 格式化知识库内容块
   */
  formatContentBlock(wikiItem) {
    const separator = '='.repeat(50);
    const header = `=== 知识库：${wikiItem.title} ===`;
    let content = `${separator}\n${header}\n${separator}\n\n${wikiItem.content}`;
    if (wikiItem.description) {
      content = `${separator}\n${header}\n【描述】${wikiItem.description}\n${separator}\n\n${wikiItem.content}`;
    }
    return content;
  }

  getCreditsPerExecution() { return 0; }
}

module.exports = KnowledgeNode;
