/**
 * Embedding向量化服务
 * 
 * 调用外部Embedding API将文本转换为向量
 * 支持OpenRouter/OpenAI兼容接口
 * 包含余弦相似度计算
 */

const axios = require('axios');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class EmbeddingService {
  /**
   * 获取Embedding配置
   * 从system_settings表读取
   * @returns {Object} 配置对象
   */
  static async getConfig() {
    try {
      const sql = "SELECT setting_value FROM system_settings WHERE setting_key = 'embedding_config'";
      const { rows } = await dbConnection.query(sql, []);
      if (rows.length === 0) {
        return EmbeddingService.getDefaultConfig();
      }
      const config = typeof rows[0].setting_value === 'string'
        ? JSON.parse(rows[0].setting_value)
        : rows[0].setting_value;
      return { ...EmbeddingService.getDefaultConfig(), ...config };
    } catch (error) {
      logger.error('获取Embedding配置失败:', error);
      return EmbeddingService.getDefaultConfig();
    }
  }

  /**
   * 默认配置
   */
  static getDefaultConfig() {
    return {
      provider: 'openrouter',
      api_endpoint: 'https://openrouter.ai/api/v1/embeddings',
      api_key: '',
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
      chunk_size: 512,
      chunk_overlap: 50,
      top_k: 5
    };
  }

  /**
   * 更新Embedding配置
   * @param {Object} config - 新配置
   */
  static async updateConfig(config) {
    try {
      const sql = `
        INSERT INTO system_settings (setting_key, setting_value) 
        VALUES ('embedding_config', ?)
        ON DUPLICATE KEY UPDATE setting_value = ?
      `;
      const value = JSON.stringify(config);
      await dbConnection.query(sql, [value, value]);
      logger.info('Embedding配置更新成功');
    } catch (error) {
      logger.error('更新Embedding配置失败:', error);
      throw error;
    }
  }

  /**
   * 将文本转换为向量
   * @param {string} text - 输入文本
   * @param {Object} configOverride - 可选的配置覆盖
   * @returns {Array<number>} 向量数组
   */
  static async embed(text, configOverride = null) {
    const config = configOverride || await EmbeddingService.getConfig();

    if (!config.api_key) {
      throw new Error('Embedding API Key未配置，请在管理后台设置');
    }

    try {
      const response = await axios.post(
        config.api_endpoint,
        {
          model: config.model,
          input: text.substring(0, 8000) /* 截断超长文本 */
        },
        {
          headers: {
            'Authorization': `Bearer ${config.api_key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai.xingyuncl.com',
            'X-Title': 'AI Platform RAG'
          },
          timeout: 30000
        }
      );

      if (response.data?.data?.[0]?.embedding) {
        return response.data.data[0].embedding;
      }

      throw new Error('Embedding API返回格式异常');
    } catch (error) {
      if (error.response) {
        logger.error('Embedding API调用失败', {
          status: error.response.status,
          data: JSON.stringify(error.response.data).substring(0, 200)
        });
        throw new Error(`Embedding API错误: ${error.response.status} - ${error.response.data?.error?.message || '未知错误'}`);
      }
      throw error;
    }
  }

  /**
   * 批量向量化（分批调用，避免超限）
   * @param {Array<string>} texts - 文本数组
   * @param {Object} configOverride - 可选配置覆盖
   * @param {Function} onProgress - 进度回调 (completed, total)
   * @returns {Array<Array<number>>} 向量数组
   */
  static async batchEmbed(texts, configOverride = null, onProgress = null) {
    const config = configOverride || await EmbeddingService.getConfig();
    const embeddings = [];

    /* 逐条调用（OpenRouter不一定支持批量input数组） */
    for (let i = 0; i < texts.length; i++) {
      try {
        const embedding = await EmbeddingService.embed(texts[i], config);
        embeddings.push(embedding);
      } catch (error) {
        logger.warn(`第${i + 1}条文本向量化失败，使用空向量:`, error.message);
        embeddings.push(null);
      }

      /* 进度回调 */
      if (onProgress) onProgress(i + 1, texts.length);

      /* 简单限流：每次请求间隔100ms */
      if (i < texts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return embeddings;
  }

  /**
   * 计算余弦相似度
   * @param {Array<number>} vecA - 向量A
   * @param {Array<number>} vecB - 向量B
   * @returns {number} 相似度值 [-1, 1]
   */
  static cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * 从chunks中检索最相似的TOP-K
   * @param {Array<number>} queryEmbedding - 查询向量
   * @param {Array} chunks - chunk数组（需含embedding字段）
   * @param {number} topK - 返回数量
   * @returns {Array} 排序后的chunks（含similarity分数）
   */
  static searchSimilar(queryEmbedding, chunks, topK = 5) {
    if (!queryEmbedding || !chunks || chunks.length === 0) return [];

    const scored = chunks
      .filter(chunk => chunk.embedding && Array.isArray(chunk.embedding))
      .map(chunk => ({
        ...chunk,
        similarity: EmbeddingService.cosineSimilarity(queryEmbedding, chunk.embedding)
      }))
      .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }
}

module.exports = EmbeddingService;
