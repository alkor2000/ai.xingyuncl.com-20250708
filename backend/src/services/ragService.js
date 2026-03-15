/**
 * RAG检索增强生成服务
 * 
 * 核心功能：
 * 1. 文本分块（chunk splitting）
 * 2. 构建向量索引（embedding + 存储）
 * 3. 语义检索（query embedding + 余弦相似度 TOP-K）
 * 4. 索引状态管理
 */

const WikiChunk = require('../models/WikiChunk');
const EmbeddingService = require('./embeddingService');
const { calculateTokens } = require('../utils/tokenCalculator');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class RAGService {
  /**
   * 将文本分割为chunks
   * 按段落+Token上限分割，保持语义完整性
   * 
   * @param {string} text - 原始文本
   * @param {number} chunkSize - 每块最大Token数（默认512）
   * @param {number} overlap - 块间重叠Token数（默认50）
   * @returns {Array<{content: string, token_count: number, char_count: number, index: number}>}
   */
  static splitIntoChunks(text, chunkSize = 512, overlap = 50) {
    if (!text || !text.trim()) return [];

    /* 按双换行分段落 */
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    const chunks = [];
    let currentChunk = '';
    let currentTokens = 0;

    for (const paragraph of paragraphs) {
      const paraTokens = calculateTokens(paragraph);

      /* 单段落超过chunkSize，强制按句子拆分 */
      if (paraTokens > chunkSize) {
        /* 先保存当前累积的chunk */
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            token_count: currentTokens,
            char_count: currentChunk.trim().length,
            index: chunks.length
          });
          currentChunk = '';
          currentTokens = 0;
        }

        /* 按句子拆分长段落 */
        const sentences = paragraph.split(/(?<=[。！？.!?\n])/);
        for (const sentence of sentences) {
          const sentTokens = calculateTokens(sentence);
          if (currentTokens + sentTokens > chunkSize && currentChunk.trim()) {
            chunks.push({
              content: currentChunk.trim(),
              token_count: currentTokens,
              char_count: currentChunk.trim().length,
              index: chunks.length
            });
            /* 重叠：保留上一块的末尾部分 */
            const overlapText = currentChunk.trim().slice(-overlap * 2);
            currentChunk = overlapText + sentence;
            currentTokens = calculateTokens(currentChunk);
          } else {
            currentChunk += sentence;
            currentTokens += sentTokens;
          }
        }
        continue;
      }

      /* 正常段落：累积到当前chunk */
      if (currentTokens + paraTokens > chunkSize && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          token_count: currentTokens,
          char_count: currentChunk.trim().length,
          index: chunks.length
        });
        /* 重叠 */
        const overlapText = currentChunk.trim().slice(-overlap * 2);
        currentChunk = overlapText + '\n\n' + paragraph;
        currentTokens = calculateTokens(currentChunk);
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        currentTokens += paraTokens;
      }
    }

    /* 最后一块 */
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        token_count: calculateTokens(currentChunk.trim()),
        char_count: currentChunk.trim().length,
        index: chunks.length
      });
    }

    logger.info('文本分块完成', {
      totalChunks: chunks.length,
      totalTokens: chunks.reduce((sum, c) => sum + c.token_count, 0),
      avgTokensPerChunk: chunks.length > 0
        ? Math.round(chunks.reduce((sum, c) => sum + c.token_count, 0) / chunks.length)
        : 0
    });

    return chunks;
  }

  /**
   * 为知识库构建向量索引
   * 完整流程：清除旧chunks → 分块 → embedding → 存储
   * 
   * @param {number} wikiId - 知识库ID
   * @param {string} content - 文本内容
   * @param {number} versionNumber - 版本号
   * @param {Function} onProgress - 进度回调 { stage, progress, message }
   * @returns {Object} { chunkCount, totalTokens, duration }
   */
  static async buildIndex(wikiId, content, versionNumber = 1, onProgress = null) {
    const startTime = Date.now();

    try {
      /* 更新状态为处理中 */
      await RAGService.updateIndexStatus(wikiId, 'processing');
      if (onProgress) onProgress({ stage: 'splitting', progress: 0, message: '正在分块...' });

      /* 1. 获取配置 */
      const config = await EmbeddingService.getConfig();

      /* 2. 分块 */
      const chunks = RAGService.splitIntoChunks(content, config.chunk_size, config.chunk_overlap);
      if (chunks.length === 0) {
        await RAGService.updateIndexStatus(wikiId, 'completed', 0);
        return { chunkCount: 0, totalTokens: 0, duration: Date.now() - startTime };
      }

      if (onProgress) onProgress({ stage: 'splitting', progress: 100, message: `分块完成: ${chunks.length}块` });

      /* 3. 清除旧chunks */
      await WikiChunk.deleteByWikiId(wikiId);

      /* 4. 向量化 */
      if (onProgress) onProgress({ stage: 'embedding', progress: 0, message: '正在向量化...' });

      const texts = chunks.map(c => c.content);
      const embeddings = await EmbeddingService.batchEmbed(
        texts, config,
        (completed, total) => {
          if (onProgress) {
            const pct = Math.round((completed / total) * 100);
            onProgress({ stage: 'embedding', progress: pct, message: `向量化: ${completed}/${total}` });
          }
        }
      );

      /* 5. 组装chunk数据 */
      const chunkRecords = chunks.map((chunk, i) => ({
        wiki_id: wikiId,
        version_number: versionNumber,
        chunk_index: chunk.index,
        content: chunk.content,
        token_count: chunk.token_count,
        char_count: chunk.char_count,
        embedding: embeddings[i],
        embedding_model: config.model,
        metadata: JSON.stringify({ chunk_index: chunk.index })
      }));

      /* 6. 批量存储 */
      if (onProgress) onProgress({ stage: 'storing', progress: 0, message: '正在存储...' });
      await WikiChunk.batchInsert(chunkRecords);

      /* 7. 更新知识库状态 */
      const totalTokens = chunks.reduce((sum, c) => sum + c.token_count, 0);
      await RAGService.updateIndexStatus(wikiId, 'completed', chunks.length);

      const duration = Date.now() - startTime;

      if (onProgress) onProgress({ stage: 'done', progress: 100, message: '索引完成' });

      logger.info('向量索引构建成功', {
        wikiId, chunkCount: chunks.length, totalTokens, duration
      });

      return { chunkCount: chunks.length, totalTokens, duration };

    } catch (error) {
      await RAGService.updateIndexStatus(wikiId, 'failed');
      logger.error('向量索引构建失败:', { wikiId, error: error.message });
      throw error;
    }
  }

  /**
   * RAG语义检索
   * 将查询文本向量化，然后在chunks中检索最相似的TOP-K
   * 
   * @param {Array<number>} wikiIds - 要检索的知识库ID列表
   * @param {string} query - 查询文本
   * @param {number} topK - 返回数量（默认从配置读取）
   * @returns {Array<{content, similarity, wiki_id, chunk_index}>} 检索结果
   */
  static async search(wikiIds, query, topK = null) {
    try {
      const config = await EmbeddingService.getConfig();
      const k = topK || config.top_k || 5;

      /* 1. 查询文本向量化 */
      const queryEmbedding = await EmbeddingService.embed(query);

      /* 2. 获取所有相关chunks */
      const chunks = await WikiChunk.findByWikiIds(wikiIds);

      if (chunks.length === 0) {
        logger.warn('RAG检索: 未找到任何chunks', { wikiIds });
        return [];
      }

      /* 3. 余弦相似度检索TOP-K */
      const results = EmbeddingService.searchSimilar(queryEmbedding, chunks, k);

      logger.info('RAG检索完成', {
        wikiIds, query: query.substring(0, 50),
        totalChunks: chunks.length, resultCount: results.length,
        topSimilarity: results.length > 0 ? results[0].similarity.toFixed(4) : 0
      });

      return results.map(r => ({
        content: r.content,
        similarity: r.similarity,
        wiki_id: r.wiki_id,
        chunk_index: r.chunk_index,
        token_count: r.token_count
      }));

    } catch (error) {
      logger.error('RAG检索失败:', { wikiIds, error: error.message });
      throw error;
    }
  }

  /**
   * 将RAG检索结果格式化为LLM上下文
   * @param {Array} results - search()返回的结果
   * @returns {string} 格式化的上下文文本
   */
  static formatAsContext(results) {
    if (!results || results.length === 0) return '';

    const parts = results.map((r, i) => {
      const sim = (r.similarity * 100).toFixed(1);
      return `[参考${i + 1}] (相关度${sim}%)\n${r.content}`;
    });

    return '以下是从知识库中检索到的相关内容，请基于这些内容回答用户问题：\n\n'
      + parts.join('\n\n---\n\n');
  }

  /**
   * 更新知识库的索引状态
   * @param {number} wikiId - 知识库ID
   * @param {string} status - none/processing/completed/failed
   * @param {number} chunkCount - 分块数量
   */
  static async updateIndexStatus(wikiId, status, chunkCount = null) {
    try {
      let sql = 'UPDATE wiki_items SET index_status = ?, rag_enabled = ?';
      const params = [status, status === 'completed' ? 1 : 0];

      if (chunkCount !== null) {
        sql += ', chunk_count = ?';
        params.push(chunkCount);
      }

      if (status === 'completed') {
        sql += ', indexed_at = NOW()';
      }

      sql += ' WHERE id = ?';
      params.push(wikiId);

      await dbConnection.query(sql, params);
    } catch (error) {
      logger.error('更新索引状态失败:', error);
    }
  }
}

module.exports = RAGService;
