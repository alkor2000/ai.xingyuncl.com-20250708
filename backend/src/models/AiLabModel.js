/**
 * AI训练专区 - 模型版本模型（ai_lab_models）+ 评测记录（ai_lab_evaluations）
 *
 * 功能：
 * - 创建模型版本：同一项目内 version 由服务端在事务内 FOR UPDATE 递增分配，
 *   分配后先回调写 artifact 文件，再插入记录（文件写失败则整体回滚）
 * - 按 ID 查询（带 artifact_url）、按项目列表（不带 artifact）
 * - 白名单更新（metrics / model_card / note）
 * - 评测记录：写入与按模型列出
 *
 * JSON 列：params / class_keys / metrics / model_card / evaluations.metrics / evaluations.errors
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

const ENGINES = ['image-knn', 'image-dense'];
const EVALUATION_SPLITS = ['holdout', 'shift'];
const MAX_EVALUATION_ERRORS = 200;

class AiLabModel {
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

  /**
   * 行 → 对外对象
   * @param {Object} row
   * @param {{withArtifact:boolean}} options - 列表场景不带 artifact 路径
   */
  static format(row, options = { withArtifact: true }) {
    if (!row) return null;
    const classKeys = AiLabModel.parseJson(row.class_keys, []);
    const model = {
      id: row.id,
      project_id: row.project_id,
      dataset_id: row.dataset_id,
      user_id: row.user_id,
      version: row.version,
      dataset_version: row.dataset_version,
      engine: row.engine,
      feature_extractor: row.feature_extractor,
      params: AiLabModel.parseJson(row.params, null),
      class_keys: Array.isArray(classKeys) ? classKeys : [],
      train_sample_count: row.train_sample_count,
      metrics: AiLabModel.parseJson(row.metrics, null),
      model_card: AiLabModel.parseJson(row.model_card, null),
      note: row.note,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    if (options.withArtifact) {
      model.artifact_path = row.artifact_path;
      model.artifact_url = row.artifact_path ? '/uploads/' + row.artifact_path : null;
    }
    return model;
  }

  /**
   * 创建模型版本
   * @param {Object} data - { project_id, dataset_id, user_id, dataset_version, engine, feature_extractor, params, class_keys, train_sample_count, note }
   * @param {Function} onVersionAllocated - async (version) => artifact_path，在事务内、插入前调用
   * @returns {Object} 新模型（带 artifact_url）
   */
  static async create(data, onVersionAllocated) {
    try {
      const id = await dbConnection.transaction(async (query) => {
        const { rows: versionRows } = await query(
          'SELECT COALESCE(MAX(version), 0) AS max_version FROM ai_lab_models WHERE project_id = ? FOR UPDATE',
          [data.project_id]
        );
        const version = Number(versionRows[0].max_version) + 1;
        const artifactPath = onVersionAllocated ? await onVersionAllocated(version) : null;

        const { rows } = await query(
          `INSERT INTO ai_lab_models (
             project_id, dataset_id, user_id, version, dataset_version, engine, feature_extractor,
             params, class_keys, train_sample_count, artifact_path, metrics, model_card, note
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          [
            data.project_id,
            data.dataset_id,
            data.user_id,
            version,
            data.dataset_version,
            data.engine,
            data.feature_extractor || 'mobilenet_v1_050_224',
            data.params ? JSON.stringify(data.params) : null,
            JSON.stringify(data.class_keys || []),
            data.train_sample_count || 0,
            artifactPath,
            data.note || null
          ]
        );
        return rows.insertId;
      });

      return AiLabModel.findById(id);
    } catch (error) {
      logger.error('创建模型版本失败:', error);
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('创建模型版本失败', error);
    }
  }

  static async findById(id) {
    try {
      const { rows } = await dbConnection.query('SELECT * FROM ai_lab_models WHERE id = ?', [id]);
      return rows.length ? AiLabModel.format(rows[0]) : null;
    } catch (error) {
      logger.error('查询模型版本失败:', error);
      throw new DatabaseError('查询模型失败', error);
    }
  }

  /**
   * 项目下的模型版本列表（按 version 升序，不带 artifact）
   */
  static async findByProject(projectId) {
    try {
      const { rows } = await dbConnection.query(
        'SELECT * FROM ai_lab_models WHERE project_id = ? ORDER BY version ASC',
        [projectId]
      );
      return rows.map(row => AiLabModel.format(row, { withArtifact: false }));
    } catch (error) {
      logger.error('查询项目模型列表失败:', error);
      throw new DatabaseError('查询模型列表失败', error);
    }
  }

  /**
   * 白名单更新：metrics / model_card / note
   */
  static async update(id, fields = {}) {
    try {
      const updateFields = [];
      const values = [];

      if (fields.metrics !== undefined) {
        updateFields.push('metrics = ?');
        values.push(fields.metrics === null ? null : JSON.stringify(fields.metrics));
      }
      if (fields.model_card !== undefined) {
        updateFields.push('model_card = ?');
        values.push(fields.model_card === null ? null : JSON.stringify(fields.model_card));
      }
      if (fields.note !== undefined) {
        updateFields.push('note = ?');
        values.push(fields.note);
      }
      if (updateFields.length === 0) return false;

      values.push(id);
      const { rows } = await dbConnection.query(
        `UPDATE ai_lab_models SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
      return rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新模型版本失败:', error);
      throw new DatabaseError('更新模型失败', error);
    }
  }

  /* ================================================================
   * 评测记录
   * ================================================================ */

  static formatEvaluation(row) {
    if (!row) return null;
    return {
      id: row.id,
      model_id: row.model_id,
      user_id: row.user_id,
      split: row.split,
      shift_set: row.shift_set,
      sample_count: row.sample_count,
      metrics: AiLabModel.parseJson(row.metrics, null),
      errors: AiLabModel.parseJson(row.errors, null),
      created_at: row.created_at
    };
  }

  /**
   * 写入一条评测记录
   * @param {Object} data - { model_id, user_id, split, shift_set, sample_count, metrics, errors }
   */
  static async createEvaluation(data) {
    try {
      const errors = Array.isArray(data.errors) ? data.errors.slice(0, MAX_EVALUATION_ERRORS) : null;
      const { rows } = await dbConnection.query(
        `INSERT INTO ai_lab_evaluations (model_id, user_id, split, shift_set, sample_count, metrics, errors)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.model_id,
          data.user_id,
          data.split,
          data.split === 'shift' ? data.shift_set : null,
          data.sample_count,
          JSON.stringify(data.metrics),
          errors ? JSON.stringify(errors) : null
        ]
      );
      return rows.insertId;
    } catch (error) {
      logger.error('写入评测记录失败:', error);
      throw new DatabaseError('写入评测记录失败', error);
    }
  }

  static async listEvaluations(modelId) {
    try {
      const { rows } = await dbConnection.query(
        'SELECT * FROM ai_lab_evaluations WHERE model_id = ? ORDER BY id ASC',
        [modelId]
      );
      return rows.map(AiLabModel.formatEvaluation);
    } catch (error) {
      logger.error('查询评测记录失败:', error);
      throw new DatabaseError('查询评测记录失败', error);
    }
  }
}

AiLabModel.ENGINES = ENGINES;
AiLabModel.EVALUATION_SPLITS = EVALUATION_SPLITS;
AiLabModel.MAX_EVALUATION_ERRORS = MAX_EVALUATION_ERRORS;

module.exports = AiLabModel;
