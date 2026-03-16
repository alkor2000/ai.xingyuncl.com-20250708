/**
 * 论坛附件模型
 * 
 * 多态关联设计：通过 target_type + target_id 关联帖子或回复
 * 支持 OSS 和本地双模式存储，复用平台 ossService
 * 
 * 附件限制：
 * - 帖子：最多9张图 + 5个文件
 * - 回复：最多3张图 + 1个文件
 * 
 * @module models/forum/ForumAttachment
 */

const BaseModel = require('./BaseModel');
const dbConnection = require('../../database/connection');
const { DatabaseError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/* 附件数量限制 */
const LIMITS = {
  post: { image: 9, file: 5 },
  reply: { image: 3, file: 1 }
};

class ForumAttachment extends BaseModel {
  /* ================================================================
   * 元信息声明
   * ================================================================ */

  static get tableName() { return 'forum_attachments'; }
  static get softDelete() { return false; }
  static get jsonColumns() { return []; }

  /* ================================================================
   * 查询方法
   * ================================================================ */

  /**
   * 获取某个目标（帖子/回复）的附件列表
   * 
   * @param {string} targetType - 'post' 或 'reply'
   * @param {number} targetId - 目标ID
   * @returns {Object[]} 附件列表
   */
  static async getByTarget(targetType, targetId) {
    try {
      return await this.findAll(
        { target_type: targetType, target_id: targetId },
        { orderBy: 'sort_order ASC, id ASC' }
      );
    } catch (error) {
      logger.error('获取附件失败:', { targetType, targetId, error: error.message });
      throw new DatabaseError('获取附件失败', error);
    }
  }

  /**
   * 批量获取多个目标的附件（减少N+1查询）
   * 
   * @param {string} targetType - 'post' 或 'reply'
   * @param {number[]} targetIds - 目标ID数组
   * @returns {Map<number, Object[]>} targetId → 附件数组的映射
   */
  static async getByTargetIds(targetType, targetIds) {
    try {
      if (!targetIds || targetIds.length === 0) return new Map();

      const placeholders = targetIds.map(() => '?').join(', ');
      const sql = `
        SELECT * FROM ${this.tableName}
        WHERE target_type = ? AND target_id IN (${placeholders})
        ORDER BY sort_order ASC, id ASC
      `;
      const { rows } = await dbConnection.simpleQuery(sql, [targetType, ...targetIds]);

      /* 按 target_id 分组 */
      const map = new Map();
      for (const row of rows) {
        if (!map.has(row.target_id)) {
          map.set(row.target_id, []);
        }
        map.get(row.target_id).push(row);
      }
      return map;
    } catch (error) {
      logger.error('批量获取附件失败:', { targetType, error: error.message });
      throw new DatabaseError('批量获取附件失败', error);
    }
  }

  /**
   * 添加附件（带数量限制检查）
   * 
   * @param {Object} data - 附件信息
   * @returns {Object} 创建的附件记录
   */
  static async addAttachment(data) {
    try {
      const { target_type, target_id, file_type } = data;

      /* 检查数量限制 */
      const limit = LIMITS[target_type]?.[file_type];
      if (limit !== undefined) {
        const currentCount = await this.count({ target_type, target_id, file_type });
        if (currentCount >= limit) {
          throw new ValidationError(
            `${target_type === 'post' ? '帖子' : '回复'}最多上传${limit}${file_type === 'image' ? '张图片' : '个文件'}`
          );
        }
      }

      return await this.create(data);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('添加附件失败:', error);
      throw new DatabaseError('添加附件失败', error);
    }
  }

  /**
   * 删除指定目标的所有附件（帖子/回复删除时联动）
   * 
   * @param {string} targetType - 'post' 或 'reply'
   * @param {number} targetId - 目标ID
   * @returns {Object[]} 被删除的附件列表（供调用方清理OSS/本地文件）
   */
  static async deleteByTarget(targetType, targetId) {
    try {
      /* 先查出来，返回给调用方做文件清理 */
      const attachments = await this.getByTarget(targetType, targetId);

      if (attachments.length > 0) {
        const sql = `DELETE FROM ${this.tableName} WHERE target_type = ? AND target_id = ?`;
        await dbConnection.query(sql, [targetType, targetId]);
        logger.info('批量删除附件记录', { targetType, targetId, count: attachments.length });
      }

      return attachments;
    } catch (error) {
      logger.error('删除附件失败:', { targetType, targetId, error: error.message });
      throw new DatabaseError('删除附件失败', error);
    }
  }
}

module.exports = ForumAttachment;
