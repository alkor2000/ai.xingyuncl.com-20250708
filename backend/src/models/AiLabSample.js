/**
 * AI训练专区 - 图片样本模型（ai_lab_samples）
 *
 * 功能：
 * - 批量创建（事务内逐条插入以拿到每条 insertId）
 * - 按 ID 查询、按数据集过滤列表（split / class_key / shift_set / include_removed）
 * - lock 候选查询（本轮新加、train、未删除）
 * - 白名单更新（class_key / condition_tags / split / shift_set）
 * - 软删除：removed_version 记当前 dataset.version，查询默认过滤 removed_version IS NULL
 *
 * 对外对象统一附 file_url = '/uploads/' + file_path
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

const SPLITS = ['train', 'holdout', 'shift'];
const SOURCES = ['camera', 'upload', 'preset', 'other_group'];

class AiLabSample {
  static parseJson(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (e) {
        return fallback;
      }
    }
    return fallback;
  }

  static format(row) {
    if (!row) return null;
    return {
      id: row.id,
      dataset_id: row.dataset_id,
      user_id: row.user_id,
      class_key: row.class_key,
      split: row.split,
      shift_set: row.shift_set,
      condition_tags: AiLabSample.parseJson(row.condition_tags, null),
      source: row.source,
      file_path: row.file_path,
      file_url: '/uploads/' + row.file_path,
      width: row.width,
      height: row.height,
      file_size: row.file_size,
      added_version: row.added_version,
      removed_version: row.removed_version,
      created_at: row.created_at
    };
  }

  /**
   * 批量创建样本（事务）
   * @param {Array<Object>} items - 每项 { dataset_id, user_id, class_key, split, shift_set, condition_tags, source, file_path, width, height, file_size, added_version }
   * @param {Function} [afterInsert] - 事务内回调 (query, insertedIds)，可用于同步维护计数
   * @returns {Array<Object>} 已创建的样本
   */
  static async createMany(items, afterInsert = null) {
    if (!items.length) return [];
    try {
      const ids = await dbConnection.transaction(async (query) => {
        const insertedIds = [];
        for (const item of items) {
          const { rows } = await query(
            `INSERT INTO ai_lab_samples (
               dataset_id, user_id, class_key, split, shift_set, condition_tags, source,
               file_path, width, height, file_size, added_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.dataset_id,
              item.user_id,
              item.class_key,
              item.split || 'train',
              item.shift_set || null,
              item.condition_tags ? JSON.stringify(item.condition_tags) : null,
              item.source || 'camera',
              item.file_path,
              item.width ?? null,
              item.height ?? null,
              item.file_size ?? null,
              item.added_version ?? 0
            ]
          );
          insertedIds.push(rows.insertId);
        }
        if (afterInsert) await afterInsert(query, insertedIds);
        return insertedIds;
      });

      return AiLabSample.findByIds(ids);
    } catch (error) {
      logger.error('批量创建样本失败:', error);
      throw new DatabaseError('创建样本失败', error);
    }
  }

  static async findByIds(ids) {
    if (!ids.length) return [];
    try {
      const placeholders = ids.map(() => '?').join(',');
      const { rows } = await dbConnection.query(
        `SELECT * FROM ai_lab_samples WHERE id IN (${placeholders}) ORDER BY id ASC`,
        ids
      );
      return rows.map(AiLabSample.format);
    } catch (error) {
      logger.error('批量查询样本失败:', error);
      throw new DatabaseError('查询样本失败', error);
    }
  }

  static async findById(id) {
    try {
      const { rows } = await dbConnection.query('SELECT * FROM ai_lab_samples WHERE id = ?', [id]);
      return rows.length ? AiLabSample.format(rows[0]) : null;
    } catch (error) {
      logger.error('查询样本失败:', error);
      throw new DatabaseError('查询样本失败', error);
    }
  }

  /**
   * 按数据集列出样本
   * @param {number} datasetId
   * @param {Object} filters - { split?, class_key?, shift_set?, include_removed? }
   */
  static async list(datasetId, filters = {}) {
    try {
      const where = ['dataset_id = ?'];
      const params = [datasetId];

      if (!filters.include_removed) where.push('removed_version IS NULL');
      if (filters.split) {
        where.push('split = ?');
        params.push(filters.split);
      }
      if (filters.class_key) {
        where.push('class_key = ?');
        params.push(filters.class_key);
      }
      if (filters.shift_set) {
        where.push('shift_set = ?');
        params.push(filters.shift_set);
      }

      const { rows } = await dbConnection.query(
        `SELECT * FROM ai_lab_samples WHERE ${where.join(' AND ')} ORDER BY id ASC`,
        params
      );
      return rows.map(AiLabSample.format);
    } catch (error) {
      logger.error('查询样本列表失败:', error);
      throw new DatabaseError('查询样本列表失败', error);
    }
  }

  /**
   * lock 候选：本轮新加（added_version = 当前 version）、split='train'、未删除
   * @returns {Array<{id:number, class_key:string}>}
   */
  static async findLockCandidates(datasetId, version) {
    try {
      const { rows } = await dbConnection.query(
        `SELECT id, class_key FROM ai_lab_samples
         WHERE dataset_id = ? AND split = 'train' AND removed_version IS NULL AND added_version = ?
         ORDER BY id ASC`,
        [datasetId, version]
      );
      return rows;
    } catch (error) {
      logger.error('查询留出候选样本失败:', error);
      throw new DatabaseError('查询留出候选失败', error);
    }
  }

  /**
   * 白名单更新：class_key / condition_tags / split / shift_set
   */
  static async update(id, fields = {}) {
    try {
      const updateFields = [];
      const values = [];

      if (fields.class_key !== undefined) {
        updateFields.push('class_key = ?');
        values.push(fields.class_key);
      }
      if (fields.condition_tags !== undefined) {
        updateFields.push('condition_tags = ?');
        values.push(fields.condition_tags === null ? null : JSON.stringify(fields.condition_tags));
      }
      if (fields.split !== undefined) {
        updateFields.push('split = ?');
        values.push(fields.split);
      }
      if (fields.shift_set !== undefined) {
        updateFields.push('shift_set = ?');
        values.push(fields.shift_set);
      }
      if (updateFields.length === 0) return false;

      values.push(id);
      const { rows } = await dbConnection.query(
        `UPDATE ai_lab_samples SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
      return rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新样本失败:', error);
      throw new DatabaseError('更新样本失败', error);
    }
  }

  /**
   * 软删除：记 removed_version = 当前 dataset.version，并同步 dataset.sample_count-1（事务）
   * @returns {boolean} 是否真的删除了（已删除的样本返回 false）
   */
  static async softDelete(id, datasetId, version) {
    try {
      return await dbConnection.transaction(async (query) => {
        const { rows } = await query(
          'UPDATE ai_lab_samples SET removed_version = ? WHERE id = ? AND removed_version IS NULL',
          [version, id]
        );
        if (rows.affectedRows === 0) return false;
        await query(
          'UPDATE ai_lab_datasets SET sample_count = GREATEST(sample_count - 1, 0) WHERE id = ?',
          [datasetId]
        );
        return true;
      });
    } catch (error) {
      logger.error('删除样本失败:', error);
      throw new DatabaseError('删除样本失败', error);
    }
  }
}

AiLabSample.SPLITS = SPLITS;
AiLabSample.SOURCES = SOURCES;

module.exports = AiLabSample;
