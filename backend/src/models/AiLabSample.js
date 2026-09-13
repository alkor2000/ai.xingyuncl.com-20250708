/**
 * AI训练专区 - 样本模型（ai_lab_samples）：图片样本与表格行样本
 *
 * 功能：
 * - 批量创建（事务内逐条插入以拿到每条 insertId；insertMany 可挂到外部事务）
 * - 按 ID 查询、按数据集过滤列表（split / class_key / shift_set / include_removed）
 * - lock 候选查询（本轮新加、train、未删除）
 * - 白名单更新（class_key / condition_tags / split / shift_set）
 * - 软删除：removed_version 记当前 dataset.version，查询默认过滤 removed_version IS NULL
 * - 混入错标：候选查询、批量改标（original_class_key 记原值）、全部恢复
 * - 预置包来源去重：按 origin_ref 查询已导入的样本
 *
 * 对外对象统一附 file_url = '/uploads/' + file_path（表格行样本 file_path 为 NULL 时 file_url 为 null）
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
      original_class_key: row.original_class_key ?? null,
      source: row.source,
      origin_ref: row.origin_ref ?? null,
      file_path: row.file_path,
      file_url: row.file_path ? '/uploads/' + row.file_path : null,
      width: row.width,
      height: row.height,
      file_size: row.file_size,
      payload: AiLabSample.parseJson(row.payload, null),
      added_version: row.added_version,
      removed_version: row.removed_version,
      created_at: row.created_at
    };
  }

  /**
   * 在给定事务内逐条插入样本（不开事务、不查询回来）
   * @param {Array<Object>} items - 每项 { dataset_id, user_id, class_key, split, shift_set, condition_tags, source, origin_ref, file_path, width, height, file_size, payload, added_version }
   * @param {Function} query - 事务内查询函数
   * @returns {Array<number>} 新样本 id（按插入顺序）
   */
  static async insertMany(items, query) {
    const insertedIds = [];
    for (const item of items) {
      const { rows } = await query(
        `INSERT INTO ai_lab_samples (
           dataset_id, user_id, class_key, split, shift_set, condition_tags, source, origin_ref,
           file_path, width, height, file_size, payload, added_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.dataset_id,
          item.user_id,
          item.class_key,
          item.split || 'train',
          item.shift_set || null,
          item.condition_tags ? JSON.stringify(item.condition_tags) : null,
          item.source || 'camera',
          item.origin_ref || null,
          item.file_path ?? null,
          item.width ?? null,
          item.height ?? null,
          item.file_size ?? null,
          item.payload ? JSON.stringify(item.payload) : null,
          item.added_version ?? 0
        ]
      );
      insertedIds.push(rows.insertId);
    }
    return insertedIds;
  }

  /**
   * 批量创建样本（自开事务）
   * @param {Array<Object>} items - 见 insertMany
   * @param {Function} [afterInsert] - 事务内回调 (query, insertedIds)，可用于同步维护计数
   * @returns {Array<Object>} 已创建的样本
   */
  static async createMany(items, afterInsert = null) {
    if (!items.length) return [];
    try {
      const ids = await dbConnection.transaction(async (query) => {
        const insertedIds = await AiLabSample.insertMany(items, query);
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
  /* ================================================================
   * 混入错标 / 恢复
   * ================================================================ */

  /**
   * 错标候选：split='train'、未删除、标签未被改过
   * @returns {Array<{id:number, class_key:string}>}
   */
  static async findMislabelCandidates(datasetId) {
    try {
      const { rows } = await dbConnection.query(
        `SELECT id, class_key FROM ai_lab_samples
         WHERE dataset_id = ? AND split = 'train' AND removed_version IS NULL AND original_class_key IS NULL
         ORDER BY id ASC`,
        [datasetId]
      );
      return rows;
    } catch (error) {
      logger.error('查询错标候选样本失败:', error);
      throw new DatabaseError('查询错标候选失败', error);
    }
  }

  /**
   * 批量改标：original_class_key 记原值，class_key 改为目标类别（事务；只改仍未被改过的样本）
   * @param {number} datasetId
   * @param {Array<{id:number, to:string}>} changes
   * @returns {Array<number>} 实际改动的样本 id
   */
  static async applyMislabels(datasetId, changes) {
    if (!changes.length) return [];
    try {
      return await dbConnection.transaction(async (query) => {
        const changedIds = [];
        for (const change of changes) {
          const { rows } = await query(
            `UPDATE ai_lab_samples
             SET original_class_key = class_key, class_key = ?
             WHERE id = ? AND dataset_id = ? AND removed_version IS NULL AND original_class_key IS NULL`,
            [change.to, change.id, datasetId]
          );
          if (rows.affectedRows > 0) changedIds.push(change.id);
        }
        return changedIds;
      });
    } catch (error) {
      logger.error('混入错标失败:', error);
      throw new DatabaseError('混入错标失败', error);
    }
  }

  /**
   * 恢复全部被改过的标签并清空 original_class_key
   * @returns {number} 恢复条数
   */
  static async restoreLabels(datasetId) {
    try {
      const { rows } = await dbConnection.query(
        `UPDATE ai_lab_samples
         SET class_key = original_class_key, original_class_key = NULL
         WHERE dataset_id = ? AND original_class_key IS NOT NULL`,
        [datasetId]
      );
      return rows.affectedRows;
    } catch (error) {
      logger.error('恢复样本标签失败:', error);
      throw new DatabaseError('恢复样本标签失败', error);
    }
  }

  /* ================================================================
   * 预置包来源
   * ================================================================ */

  /**
   * 数据集内未删除样本的 origin_ref 集合（用于重复导入去重）
   * @returns {Set<string>}
   */
  static async findOriginRefs(datasetId) {
    try {
      const { rows } = await dbConnection.query(
        `SELECT origin_ref FROM ai_lab_samples
         WHERE dataset_id = ? AND removed_version IS NULL AND origin_ref IS NOT NULL`,
        [datasetId]
      );
      return new Set(rows.map(row => row.origin_ref));
    } catch (error) {
      logger.error('查询样本来源失败:', error);
      throw new DatabaseError('查询样本来源失败', error);
    }
  }
}

AiLabSample.SPLITS = SPLITS;
AiLabSample.SOURCES = SOURCES;

module.exports = AiLabSample;
