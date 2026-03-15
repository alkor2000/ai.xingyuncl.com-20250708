/**
 * Wiki分块数据模型
 * 
 * 管理知识库文档的分块和向量数据
 * 支持按知识库/版本管理chunks，以及余弦相似度检索
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class WikiChunk {
  constructor(data) {
    Object.assign(this, data);
  }

  /**
   * 批量插入chunks
   * @param {Array} chunks - [{ wiki_id, version_number, chunk_index, content, token_count, char_count, embedding, embedding_model, metadata }]
   * @returns {number} 插入数量
   */
  static async batchInsert(chunks) {
    if (!chunks || chunks.length === 0) return 0;

    const transaction = await dbConnection.beginTransaction();
    try {
      /* 分批插入，每批50条避免SQL过长 */
      const batchSize = 50;
      let inserted = 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = [];

        for (const chunk of batch) {
          values.push(
            chunk.wiki_id,
            chunk.version_number,
            chunk.chunk_index,
            chunk.content,
            chunk.token_count || 0,
            chunk.char_count || chunk.content.length,
            chunk.embedding ? JSON.stringify(chunk.embedding) : null,
            chunk.embedding_model || null,
            chunk.metadata ? JSON.stringify(chunk.metadata) : null
          );
        }

        const sql = `
          INSERT INTO wiki_chunks 
          (wiki_id, version_number, chunk_index, content, token_count, char_count, embedding, embedding_model, metadata)
          VALUES ${placeholders}
        `;
        await transaction.query(sql, values);
        inserted += batch.length;
      }

      await transaction.commit();
      logger.info('批量插入chunks成功', { count: inserted });
      return inserted;
    } catch (error) {
      await transaction.rollback();
      logger.error('批量插入chunks失败:', error);
      throw error;
    }
  }

  /**
   * 删除知识库的所有chunks
   * @param {number} wikiId - 知识库ID
   * @returns {number} 删除数量
   */
  static async deleteByWikiId(wikiId) {
    try {
      const sql = 'DELETE FROM wiki_chunks WHERE wiki_id = ?';
      const { rows } = await dbConnection.query(sql, [wikiId]);
      logger.info('删除chunks成功', { wikiId, count: rows.affectedRows });
      return rows.affectedRows;
    } catch (error) {
      logger.error('删除chunks失败:', error);
      throw error;
    }
  }

  /**
   * 获取知识库的chunk数量
   * @param {number} wikiId - 知识库ID
   * @returns {number}
   */
  static async getCountByWikiId(wikiId) {
    try {
      const sql = 'SELECT COUNT(*) as count FROM wiki_chunks WHERE wiki_id = ?';
      const { rows } = await dbConnection.query(sql, [wikiId]);
      return rows[0].count;
    } catch (error) {
      logger.error('获取chunk数量失败:', error);
      return 0;
    }
  }

  /**
   * 获取知识库的所有chunks（含向量）
   * 用于相似度检索
   * @param {number} wikiId - 知识库ID
   * @returns {Array}
   */
  static async findByWikiId(wikiId) {
    try {
      const sql = `
        SELECT id, wiki_id, version_number, chunk_index, content, 
               token_count, char_count, embedding, embedding_model, metadata
        FROM wiki_chunks 
        WHERE wiki_id = ?
        ORDER BY chunk_index ASC
      `;
      const { rows } = await dbConnection.query(sql, [wikiId]);

      return rows.map(row => {
        /* 解析JSON字段 */
        if (row.embedding && typeof row.embedding === 'string') {
          try { row.embedding = JSON.parse(row.embedding); } catch (e) { row.embedding = null; }
        }
        if (row.metadata && typeof row.metadata === 'string') {
          try { row.metadata = JSON.parse(row.metadata); } catch (e) { row.metadata = null; }
        }
        return new WikiChunk(row);
      });
    } catch (error) {
      logger.error('获取chunks失败:', error);
      throw error;
    }
  }

  /**
   * 获取多个知识库的所有chunks（批量检索用）
   * @param {Array<number>} wikiIds - 知识库ID数组
   * @returns {Array}
   */
  static async findByWikiIds(wikiIds) {
    if (!wikiIds || wikiIds.length === 0) return [];
    try {
      const placeholders = wikiIds.map(() => '?').join(', ');
      const sql = `
        SELECT id, wiki_id, version_number, chunk_index, content, 
               token_count, char_count, embedding, embedding_model, metadata
        FROM wiki_chunks 
        WHERE wiki_id IN (${placeholders})
        ORDER BY wiki_id, chunk_index ASC
      `;
      const { rows } = await dbConnection.query(sql, wikiIds);

      return rows.map(row => {
        if (row.embedding && typeof row.embedding === 'string') {
          try { row.embedding = JSON.parse(row.embedding); } catch (e) { row.embedding = null; }
        }
        if (row.metadata && typeof row.metadata === 'string') {
          try { row.metadata = JSON.parse(row.metadata); } catch (e) { row.metadata = null; }
        }
        return new WikiChunk(row);
      });
    } catch (error) {
      logger.error('批量获取chunks失败:', error);
      throw error;
    }
  }

  /**
   * 更新单个chunk的向量
   * @param {number} chunkId - chunk ID
   * @param {Array<number>} embedding - 向量数组
   * @param {string} model - 模型名
   */
  static async updateEmbedding(chunkId, embedding, model) {
    try {
      const sql = 'UPDATE wiki_chunks SET embedding = ?, embedding_model = ? WHERE id = ?';
      await dbConnection.query(sql, [JSON.stringify(embedding), model, chunkId]);
    } catch (error) {
      logger.error('更新chunk向量失败:', error);
      throw error;
    }
  }
}

module.exports = WikiChunk;
