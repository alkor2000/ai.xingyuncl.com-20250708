/**
 * AI训练专区 - 数据集模型（ai_lab_datasets）
 *
 * 功能：
 * - 类别定义校验（key 只允许 [a-z0-9_-]{1,32} 且唯一）
 * - 列定义校验 columns = [{key, label, type:'number'|'category'|'text', unit?}]（key 规则同类别）
 *   文本数据集的 columns 固定为 TEXT_COLUMNS = [{key:'text', label:'文本', type:'text'}]，创建时未传则自动填
 * - 创建（可参与外部事务）、按 ID / 按项目查询、更新 name/classes/kind/columns（可参与外部事务）
 * - 三集样本计数 counts = {train:{class_key:n}, holdout:{...}, shift:{'<set>':{class_key:n}}}
 * - lock：把选中的样本改为 holdout 并让 version+1（事务）
 * - sample_count 维护（增量与全量重算）
 *
 * 说明：holdout_ratio 是 DECIMAL，mysql2 返回字符串，读出时转 number；kind 为 image | table | audio | text
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

const CLASS_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;
const MAX_CLASSES = 50;
const KINDS = ['image', 'table', 'audio', 'text'];
const COLUMN_TYPES = ['number', 'category', 'text'];
const MAX_COLUMNS = 50;
/** 文本数据集固定的列定义 */
const TEXT_COLUMNS = [{ key: 'text', label: '文本', type: 'text' }];
const KIND_ERROR = 'kind 只能是 image、table、audio 或 text';

class AiLabDataset {
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
    const classes = AiLabDataset.parseJson(row.classes, []);
    const columns = AiLabDataset.parseJson(row.columns, null);
    return {
      id: row.id,
      project_id: row.project_id,
      user_id: row.user_id,
      name: row.name,
      kind: row.kind || 'image',
      classes: Array.isArray(classes) ? classes : [],
      columns: Array.isArray(columns) ? columns : null,
      version: row.version,
      holdout_ratio: row.holdout_ratio === null || row.holdout_ratio === undefined ? null : parseFloat(row.holdout_ratio),
      seed: row.seed,
      locked_at: row.locked_at,
      sample_count: row.sample_count,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * 校验并规范化类别数组：[{key, label}]
   * @returns {Array<{key:string,label:string}>}
   */
  static validateClasses(classes) {
    if (!Array.isArray(classes)) throw new ValidationError('classes 必须是数组');
    if (classes.length > MAX_CLASSES) throw new ValidationError(`类别数量不能超过 ${MAX_CLASSES} 个`);

    const seen = new Set();
    return classes.map((item, index) => {
      const key = typeof item === 'string' ? item : (item && item.key);
      if (typeof key !== 'string' || !CLASS_KEY_PATTERN.test(key)) {
        throw new ValidationError(`第 ${index + 1} 个类别的 key 无效：只允许小写字母、数字、下划线和短横线，1-32 位`);
      }
      if (seen.has(key)) throw new ValidationError(`类别 key 重复：${key}`);
      seen.add(key);

      let label = item && typeof item === 'object' && item.label !== undefined ? String(item.label).trim() : '';
      if (!label) label = key;
      if (label.length > 50) throw new ValidationError(`类别 ${key} 的名称不能超过 50 字`);

      return { key, label };
    });
  }

  /**
   * 校验并规范化表格列定义：[{key, label, type, unit?}]
   * @returns {Array<{key:string,label:string,type:string,unit?:string}>}
   */
  static validateColumns(columns) {
    if (!Array.isArray(columns)) throw new ValidationError('columns 必须是数组');
    if (columns.length > MAX_COLUMNS) throw new ValidationError(`列数量不能超过 ${MAX_COLUMNS} 个`);

    const seen = new Set();
    return columns.map((item, index) => {
      const key = typeof item === 'string' ? item : (item && item.key);
      if (typeof key !== 'string' || !CLASS_KEY_PATTERN.test(key)) {
        throw new ValidationError(`第 ${index + 1} 列的 key 无效：只允许小写字母、数字、下划线和短横线，1-32 位`);
      }
      if (seen.has(key)) throw new ValidationError(`列 key 重复：${key}`);
      seen.add(key);

      const type = item && typeof item === 'object' && item.type !== undefined ? String(item.type) : 'number';
      if (!COLUMN_TYPES.includes(type)) throw new ValidationError(`列 ${key} 的 type 只能是 number、category 或 text`);

      let label = item && typeof item === 'object' && item.label !== undefined ? String(item.label).trim() : '';
      if (!label) label = key;
      if (label.length > 50) throw new ValidationError(`列 ${key} 的名称不能超过 50 字`);

      const column = { key, label, type };
      if (item && typeof item === 'object' && item.unit !== undefined && item.unit !== null) {
        const unit = String(item.unit).trim();
        if (unit.length > 20) throw new ValidationError(`列 ${key} 的单位不能超过 20 字`);
        if (unit) column.unit = unit;
      }
      return column;
    });
  }

  /**
   * 某类数据集的列定义：text 固定 TEXT_COLUMNS；table 用传入值；image/audio 无列
   */
  static columnsForKind(kind, columns) {
    if (kind === 'text') return TEXT_COLUMNS.map(col => ({ ...col }));
    if (kind === 'table') return columns === undefined || columns === null ? null : AiLabDataset.validateColumns(columns);
    return null;
  }

  /**
   * 创建数据集
   * @param {Object} data - { project_id, user_id, name, classes, kind?, columns? }（text 的 columns 自动固定）
   * @param {Function} [query] - 事务内查询函数
   * @returns {number} 新数据集 ID
   */
  static async create(data, query = null) {
    const q = query || ((sql, params) => dbConnection.query(sql, params));
    try {
      const classes = AiLabDataset.validateClasses(data.classes || []);
      const kind = data.kind || 'image';
      if (!KINDS.includes(kind)) throw new ValidationError(KIND_ERROR);
      const columns = AiLabDataset.columnsForKind(kind, data.columns);
      const { rows } = await q(
        `INSERT INTO ai_lab_datasets (project_id, user_id, name, kind, classes, columns, version, sample_count)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        [data.project_id, data.user_id, data.name, kind, JSON.stringify(classes), columns ? JSON.stringify(columns) : null]
      );
      return rows.insertId;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('创建AI实验数据集失败:', error);
      throw new DatabaseError('创建数据集失败', error);
    }
  }

  static async findById(id) {
    try {
      const { rows } = await dbConnection.query('SELECT * FROM ai_lab_datasets WHERE id = ?', [id]);
      return rows.length ? AiLabDataset.format(rows[0]) : null;
    } catch (error) {
      logger.error('查询AI实验数据集失败:', error);
      throw new DatabaseError('查询数据集失败', error);
    }
  }

  static async findByProject(projectId) {
    try {
      const { rows } = await dbConnection.query(
        'SELECT * FROM ai_lab_datasets WHERE project_id = ? ORDER BY id ASC',
        [projectId]
      );
      return rows.map(AiLabDataset.format);
    } catch (error) {
      logger.error('查询项目数据集列表失败:', error);
      throw new DatabaseError('查询数据集列表失败', error);
    }
  }

  /**
   * 更新 name / classes / kind / columns（classes 需由调用方先做"不能删除有样本的 key"校验）
   * @param {Function} [query] - 事务内查询函数（可选）
   */
  static async update(id, fields = {}, query = null) {
    const q = query || ((sql, params) => dbConnection.query(sql, params));
    try {
      const updateFields = [];
      const values = [];

      if (fields.name !== undefined) {
        updateFields.push('name = ?');
        values.push(fields.name);
      }
      if (fields.classes !== undefined) {
        updateFields.push('classes = ?');
        values.push(JSON.stringify(AiLabDataset.validateClasses(fields.classes)));
      }
      if (fields.kind !== undefined) {
        if (!KINDS.includes(fields.kind)) throw new ValidationError(KIND_ERROR);
        updateFields.push('kind = ?');
        values.push(fields.kind);
      }
      if (fields.columns !== undefined) {
        updateFields.push('columns = ?');
        values.push(fields.columns === null ? null : JSON.stringify(AiLabDataset.validateColumns(fields.columns)));
      }
      if (updateFields.length === 0) return false;

      values.push(id);
      const { rows } = await q(
        `UPDATE ai_lab_datasets SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
      return rows.affectedRows > 0;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('更新AI实验数据集失败:', error);
      throw new DatabaseError('更新数据集失败', error);
    }
  }

  /**
   * 三集样本计数（未删除样本）
   * @returns {{train:Object, holdout:Object, shift:Object}}
   */
  static async getCounts(datasetId, classes = null) {
    try {
      const { rows } = await dbConnection.query(
        `SELECT split, shift_set, class_key, COUNT(*) AS n
         FROM ai_lab_samples
         WHERE dataset_id = ? AND removed_version IS NULL
         GROUP BY split, shift_set, class_key`,
        [datasetId]
      );

      const counts = { train: {}, holdout: {}, shift: {} };
      if (Array.isArray(classes)) {
        classes.forEach(cls => {
          counts.train[cls.key] = 0;
          counts.holdout[cls.key] = 0;
        });
      }

      rows.forEach(row => {
        const n = Number(row.n);
        if (row.split === 'shift') {
          const setName = row.shift_set || 'default';
          if (!counts.shift[setName]) counts.shift[setName] = {};
          counts.shift[setName][row.class_key] = (counts.shift[setName][row.class_key] || 0) + n;
        } else {
          counts[row.split][row.class_key] = (counts[row.split][row.class_key] || 0) + n;
        }
      });

      return counts;
    } catch (error) {
      logger.error('统计数据集样本失败:', error);
      throw new DatabaseError('统计样本失败', error);
    }
  }

  /**
   * 仍有未删除样本的类别 key 集合
   */
  static async getClassKeysWithSamples(datasetId) {
    try {
      const { rows } = await dbConnection.query(
        `SELECT DISTINCT class_key FROM ai_lab_samples WHERE dataset_id = ? AND removed_version IS NULL`,
        [datasetId]
      );
      return new Set(rows.map(row => row.class_key));
    } catch (error) {
      logger.error('查询数据集类别使用情况失败:', error);
      throw new DatabaseError('查询类别使用情况失败', error);
    }
  }

  /**
   * lock：选中样本改为 holdout，version+1，写回 holdout_ratio/seed/locked_at（事务）
   * @param {number} datasetId
   * @param {Array<number>} holdoutIds - 由 splitHoldout 选出的样本 id
   * @param {{holdout_ratio:number, seed:number}} options
   */
  static async lock(datasetId, holdoutIds, options) {
    try {
      await dbConnection.transaction(async (query) => {
        if (holdoutIds.length > 0) {
          const placeholders = holdoutIds.map(() => '?').join(',');
          await query(
            `UPDATE ai_lab_samples SET split = 'holdout', shift_set = NULL
             WHERE dataset_id = ? AND removed_version IS NULL AND split = 'train' AND id IN (${placeholders})`,
            [datasetId, ...holdoutIds]
          );
        }
        await query(
          `UPDATE ai_lab_datasets
           SET version = version + 1, holdout_ratio = ?, seed = ?, locked_at = NOW()
           WHERE id = ?`,
          [options.holdout_ratio, options.seed, datasetId]
        );
      });
      logger.info('数据集留出划分锁定', { datasetId, holdoutAdded: holdoutIds.length, ...options });
      return true;
    } catch (error) {
      logger.error('锁定数据集失败:', error);
      throw new DatabaseError('锁定数据集失败', error);
    }
  }

  /**
   * sample_count 增量调整（可为负，最低 0）
   * @param {Function} [query] - 事务内查询函数
   */
  static async adjustSampleCount(datasetId, delta, query = null) {
    const q = query || ((sql, params) => dbConnection.query(sql, params));
    try {
      await q(
        'UPDATE ai_lab_datasets SET sample_count = GREATEST(sample_count + ?, 0) WHERE id = ?',
        [delta, datasetId]
      );
    } catch (error) {
      logger.error('更新数据集样本计数失败:', error);
      throw new DatabaseError('更新样本计数失败', error);
    }
  }

  /**
   * sample_count 全量重算（兜底）
   */
  static async recountSamples(datasetId) {
    try {
      await dbConnection.query(
        `UPDATE ai_lab_datasets d
         SET d.sample_count = (SELECT COUNT(*) FROM ai_lab_samples s WHERE s.dataset_id = d.id AND s.removed_version IS NULL)
         WHERE d.id = ?`,
        [datasetId]
      );
    } catch (error) {
      logger.error('重算数据集样本计数失败:', error);
      throw new DatabaseError('重算样本计数失败', error);
    }
  }

  /**
   * 项目下全部数据集的未删除样本总数
   */
  static async sumSampleCountByProject(projectId) {
    try {
      const { rows } = await dbConnection.query(
        'SELECT COALESCE(SUM(sample_count), 0) AS total FROM ai_lab_datasets WHERE project_id = ?',
        [projectId]
      );
      return Number(rows[0].total) || 0;
    } catch (error) {
      logger.error('统计项目样本总数失败:', error);
      throw new DatabaseError('统计样本总数失败', error);
    }
  }
}

AiLabDataset.CLASS_KEY_PATTERN = CLASS_KEY_PATTERN;
AiLabDataset.KINDS = KINDS;
AiLabDataset.COLUMN_TYPES = COLUMN_TYPES;
AiLabDataset.TEXT_COLUMNS = TEXT_COLUMNS;
AiLabDataset.KIND_ERROR = KIND_ERROR;

module.exports = AiLabDataset;
