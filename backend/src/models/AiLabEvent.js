/**
 * AI训练专区 - 过程事件模型（ai_lab_events）
 *
 * 功能：
 * - 批量写入（单条多行 INSERT，≤50 条/次由控制器限制）
 * - 按项目、按 id 升序增量拉取（after_id + limit）
 *
 * type 白名单在 config/aiLabTasks.js（AI_LAB_EVENT_TYPES），由控制器校验
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class AiLabEvent {
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
      project_id: row.project_id,
      user_id: row.user_id,
      type: row.type,
      payload: AiLabEvent.parseJson(row.payload, null),
      client_ts: row.client_ts,
      created_at: row.created_at
    };
  }

  /**
   * 批量写入事件
   * @param {number} projectId
   * @param {number} userId
   * @param {Array<{type:string, payload?:Object, client_ts?:Date|null}>} events
   * @returns {number} 写入条数
   */
  static async createMany(projectId, userId, events) {
    if (!events.length) return 0;
    try {
      const placeholders = events.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params = [];
      events.forEach(event => {
        params.push(
          projectId,
          userId,
          event.type,
          event.payload === undefined || event.payload === null ? null : JSON.stringify(event.payload),
          event.client_ts || null
        );
      });
      const { rows } = await dbConnection.query(
        `INSERT INTO ai_lab_events (project_id, user_id, type, payload, client_ts) VALUES ${placeholders}`,
        params
      );
      return rows.affectedRows;
    } catch (error) {
      logger.error('写入过程事件失败:', error);
      throw new DatabaseError('写入过程事件失败', error);
    }
  }

  /**
   * 增量拉取：id > afterId，按 id 升序
   */
  static async list(projectId, { afterId = 0, limit = 200 } = {}) {
    try {
      const safeAfter = Math.max(parseInt(afterId, 10) || 0, 0);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
      const { rows } = await dbConnection.query(
        `SELECT * FROM ai_lab_events WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT ${safeLimit}`,
        [projectId, safeAfter]
      );
      return rows.map(AiLabEvent.format);
    } catch (error) {
      logger.error('查询过程事件失败:', error);
      throw new DatabaseError('查询过程事件失败', error);
    }
  }
}

module.exports = AiLabEvent;
