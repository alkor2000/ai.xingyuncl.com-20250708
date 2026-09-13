/**
 * AI训练专区 - 实验项目模型（ai_lab_projects）
 *
 * 功能：
 * - 创建项目（可参与外部事务，用于与默认数据集一起创建）
 * - 按 ID 查询、白名单字段更新
 * - 我的项目分页列表、管理端按组/用户分页列表（附所有者 username）
 *
 * 说明：
 * - context / summary 为 JSON 列，读出时统一解析为对象
 * - LIMIT/OFFSET 走 pool.execute 不支持参数绑定，按 WikiItem 的做法内联已校验的整数
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

const PROJECT_STATUSES = ['active', 'archived'];
const PARTICIPATION_MODES = ['individual', 'group', 'projected'];

class AiLabProject {
  /**
   * 安全解析 JSON 列（mysql2 可能已解析为对象，也可能是字符串）
   */
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
   */
  static format(row) {
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      group_id: row.group_id,
      title: row.title,
      task_key: row.task_key,
      task_version: row.task_version,
      participation_mode: row.participation_mode,
      status: row.status,
      context: AiLabProject.parseJson(row.context, null),
      summary: AiLabProject.parseJson(row.summary, null),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * 创建项目
   * @param {Object} data - { user_id, group_id, title, task_key, task_version, participation_mode, context }
   * @param {Function} [query] - 事务内查询函数（可选）
   * @returns {number} 新项目 ID
   */
  static async create(data, query = null) {
    const q = query || ((sql, params) => dbConnection.query(sql, params));
    try {
      const sql = `
        INSERT INTO ai_lab_projects (
          user_id, group_id, title, task_key, task_version, participation_mode, status, context, summary
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `;
      const { rows } = await q(sql, [
        data.user_id,
        data.group_id ?? null,
        data.title,
        data.task_key || 'free',
        data.task_version || '1',
        data.participation_mode || 'individual',
        data.context ? JSON.stringify(data.context) : null,
        JSON.stringify({
          sample_count: 0,
          model_count: 0,
          best_holdout_accuracy: null,
          best_shift_accuracy: null,
          generalization_gap: null
        })
      ]);
      return rows.insertId;
    } catch (error) {
      logger.error('创建AI实验项目失败:', error);
      throw new DatabaseError('创建项目失败', error);
    }
  }

  /**
   * 按 ID 查询
   */
  static async findById(id) {
    try {
      const { rows } = await dbConnection.query('SELECT * FROM ai_lab_projects WHERE id = ?', [id]);
      return rows.length ? AiLabProject.format(rows[0]) : null;
    } catch (error) {
      logger.error('查询AI实验项目失败:', error);
      throw new DatabaseError('查询项目失败', error);
    }
  }

  /**
   * 白名单字段更新：title / status / participation_mode / context / summary
   */
  static async update(id, fields = {}) {
    try {
      const updateFields = [];
      const values = [];

      if (fields.title !== undefined) {
        updateFields.push('title = ?');
        values.push(fields.title);
      }
      if (fields.status !== undefined) {
        if (!PROJECT_STATUSES.includes(fields.status)) throw new ValidationError('无效的项目状态');
        updateFields.push('status = ?');
        values.push(fields.status);
      }
      if (fields.participation_mode !== undefined) {
        if (!PARTICIPATION_MODES.includes(fields.participation_mode)) throw new ValidationError('无效的参与方式');
        updateFields.push('participation_mode = ?');
        values.push(fields.participation_mode);
      }
      if (fields.context !== undefined) {
        updateFields.push('context = ?');
        values.push(fields.context === null ? null : JSON.stringify(fields.context));
      }
      if (fields.summary !== undefined) {
        updateFields.push('summary = ?');
        values.push(fields.summary === null ? null : JSON.stringify(fields.summary));
      }

      if (updateFields.length === 0) return false;

      values.push(id);
      const { rows } = await dbConnection.query(
        `UPDATE ai_lab_projects SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
      return rows.affectedRows > 0;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('更新AI实验项目失败:', error);
      throw new DatabaseError('更新项目失败', error);
    }
  }

  /**
   * 分页列表
   * @param {Object} filters - { userId?, groupId?, status? ('active'|'archived'|'all'), page, limit, withUser }
   * @returns {{ items: Array, total: number, page: number, limit: number }}
   */
  static async list(filters = {}) {
    try {
      const page = Math.max(parseInt(filters.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 100);
      const offset = (page - 1) * limit;

      const where = [];
      const params = [];

      if (filters.userId) {
        where.push('p.user_id = ?');
        params.push(filters.userId);
      }
      if (filters.groupId) {
        where.push('p.group_id = ?');
        params.push(filters.groupId);
      }
      if (filters.status && filters.status !== 'all') {
        if (!PROJECT_STATUSES.includes(filters.status)) throw new ValidationError('无效的项目状态');
        where.push('p.status = ?');
        params.push(filters.status);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const { rows: countRows } = await dbConnection.query(
        `SELECT COUNT(*) AS total FROM ai_lab_projects p ${whereSql}`,
        params
      );
      const total = countRows[0].total;

      const userSelect = filters.withUser ? ', u.username AS owner_username' : '';
      const userJoin = filters.withUser ? 'LEFT JOIN users u ON u.id = p.user_id' : '';

      const { rows } = await dbConnection.query(
        `SELECT p.*${userSelect}
         FROM ai_lab_projects p
         ${userJoin}
         ${whereSql}
         ORDER BY p.updated_at DESC, p.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      const items = rows.map(row => {
        const project = AiLabProject.format(row);
        if (filters.withUser) {
          /* users 表没有 nickname 列，保留字段占位以符合契约 */
          project.user = { id: row.user_id, username: row.owner_username || null, nickname: null };
        }
        return project;
      });

      return { items, total, page, limit };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('查询AI实验项目列表失败:', error);
      throw new DatabaseError('查询项目列表失败', error);
    }
  }
}

AiLabProject.PROJECT_STATUSES = PROJECT_STATUSES;
AiLabProject.PARTICIPATION_MODES = PARTICIPATION_MODES;

module.exports = AiLabProject;
