/**
 * 论坛回复模型
 * 
 * 扁平评论结构：所有回复直属帖子，通过 reply_to_id 实现楼中楼引用
 * floor_number 在创建时原子自增分配（SELECT MAX + 1，事务内）
 * 
 * @module models/forum/ForumReply
 */

const BaseModel = require('./BaseModel');
const dbConnection = require('../../database/connection');
const { DatabaseError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/* 30分钟自由编辑窗口（毫秒） */
const FREE_EDIT_WINDOW_MS = 30 * 60 * 1000;

class ForumReply extends BaseModel {
  /* ================================================================
   * 元信息声明
   * ================================================================ */

  static get tableName() { return 'forum_replies'; }
  static get softDelete() { return true; }
  static get jsonColumns() { return []; }

  /* ================================================================
   * 查询方法
   * ================================================================ */

  /**
   * 获取帖子的回复列表（分页）
   * 
   * 按楼层号正序排列，隐藏的回复对普通用户不可见
   * 
   * @param {number} postId - 帖子ID
   * @param {Object} options - 分页选项
   * @param {number} options.page - 页码
   * @param {number} options.limit - 每页数量
   * @param {number|null} options.userId - 当前用户ID（获取点赞状态）
   * @param {boolean} options.showHidden - 是否显示隐藏回复
   * @returns {Object} { items, pagination }
   */
  static async getListByPost(postId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        userId = null,
        showHidden = false
      } = options;

      const safePage = Math.max(1, parseInt(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
      const offset = (safePage - 1) * safeLimit;

      /* WHERE */
      const conditions = ['r.post_id = ?', 'r.deleted_at IS NULL'];
      const params = [postId];
      if (!showHidden) {
        conditions.push('r.is_hidden = 0');
      }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      /* COUNT */
      const countSql = `SELECT COUNT(*) as total FROM forum_replies r ${whereClause}`;
      const { rows: countRows } = await dbConnection.simpleQuery(countSql, params);
      const total = countRows[0].total;

      /* 数据 */
      let selectFields = `
        r.*,
        u.username AS author_name,
        ru.username AS reply_to_username
      `;
      let joins = `
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN users ru ON r.reply_to_user_id = ru.id
      `;

      if (userId) {
        selectFields += `, IF(fl.id IS NOT NULL, 1, 0) AS is_liked`;
        joins += ` LEFT JOIN forum_likes fl ON fl.target_type = 'reply' AND fl.target_id = r.id AND fl.user_id = ?`;
        params.unshift(userId);
      }

      const dataSql = `
        SELECT ${selectFields}
        FROM forum_replies r
        ${joins}
        ${whereClause}
        ORDER BY r.floor_number ASC
        LIMIT ? OFFSET ?
      `;
      const { rows } = await dbConnection.simpleQuery(dataSql, [...params, safeLimit, offset]);

      return {
        items: rows,
        pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) }
      };
    } catch (error) {
      logger.error('获取回复列表失败:', { postId, error: error.message });
      throw new DatabaseError('获取回复列表失败', error);
    }
  }

  /* ================================================================
   * 写入方法
   * ================================================================ */

  /**
   * 发布回复（事务内分配楼层号）
   * 
   * @param {Object} data - 回复数据 { post_id, content, reply_to_id? }
   * @param {Object} user - 回复用户 { id }
   * @param {string} ipAddress - 客户端IP
   * @returns {Object} 新回复记录
   */
  static async createReply(data, user, ipAddress = null) {
    try {
      const { post_id, content, reply_to_id = null } = data;

      if (!content || !content.trim()) throw new ValidationError('回复内容不能为空');
      if (!post_id) throw new ValidationError('必须指定帖子');

      /* 事务内原子分配楼层号 */
      const result = await dbConnection.transaction(async (query) => {
        /* 获取当前最大楼层号 */
        const maxSql = 'SELECT COALESCE(MAX(floor_number), 0) AS max_floor FROM forum_replies WHERE post_id = ?';
        const { rows: maxRows } = await query(maxSql, [post_id]);
        const floorNumber = maxRows[0].max_floor + 1;

        /* 如果有楼中楼引用，获取被引用回复的作者 */
        let replyToUserId = null;
        if (reply_to_id) {
          const refSql = 'SELECT user_id FROM forum_replies WHERE id = ? AND post_id = ?';
          const { rows: refRows } = await query(refSql, [reply_to_id, post_id]);
          if (refRows.length > 0) {
            replyToUserId = refRows[0].user_id;
          }
        }

        /* 插入回复 */
        const insertSql = `
          INSERT INTO forum_replies (post_id, user_id, content, floor_number, reply_to_id, reply_to_user_id, ip_address)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const { rows: insertResult } = await query(insertSql, [
          post_id, user.id, content.trim(), floorNumber,
          reply_to_id, replyToUserId, ipAddress
        ]);

        /* 更新帖子的回复计数和最后回复信息 */
        const updatePostSql = `
          UPDATE forum_posts
          SET reply_count = reply_count + 1,
              last_reply_at = NOW(),
              last_reply_user_id = ?
          WHERE id = ?
        `;
        await query(updatePostSql, [user.id, post_id]);

        return insertResult.insertId;
      });

      return await this.findById(result);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('发布回复失败:', { postId: data.post_id, error: error.message });
      throw new DatabaseError('发布回复失败', error);
    }
  }

  /**
   * 编辑回复（带30分钟自由编辑窗口）
   * 
   * @param {number} replyId - 回复ID
   * @param {string} content - 新内容
   * @returns {Object} 更新后的回复
   */
  static async editReply(replyId, content) {
    try {
      if (!content || !content.trim()) throw new ValidationError('回复内容不能为空');

      const reply = await this.findById(replyId);
      if (!reply) throw new ValidationError('回复不存在');

      const updateData = { content: content.trim() };

      const elapsed = Date.now() - new Date(reply.created_at).getTime();
      if (elapsed > FREE_EDIT_WINDOW_MS) {
        updateData.edit_count = (reply.edit_count || 0) + 1;
        updateData.last_edited_at = new Date();
      }

      return await this.updateById(replyId, updateData);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('编辑回复失败:', { replyId, error: error.message });
      throw new DatabaseError('编辑回复失败', error);
    }
  }

  /**
   * 删除回复（软删除 + 更新帖子计数）
   * 
   * @param {number} replyId - 回复ID
   * @param {number} postId - 所属帖子ID
   * @returns {boolean} 是否成功
   */
  static async deleteReply(replyId, postId) {
    try {
      const success = await this.deleteById(replyId);
      if (success) {
        /* 减少帖子回复计数 */
        const sql = `UPDATE forum_posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = ?`;
        await dbConnection.query(sql, [postId]);
      }
      return success;
    } catch (error) {
      logger.error('删除回复失败:', { replyId, error: error.message });
      throw new DatabaseError('删除回复失败', error);
    }
  }
}

module.exports = ForumReply;
