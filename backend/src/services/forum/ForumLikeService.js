/**
 * 论坛点赞/收藏服务
 * 
 * 统一管理帖子和回复的点赞、帖子的收藏操作
 * 使用 ON DUPLICATE KEY 实现幂等的 toggle 切换
 * 
 * @module services/forum/ForumLikeService
 */

const dbConnection = require('../../database/connection');
const { DatabaseError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class ForumLikeService {

  /* ================================================================
   * 点赞
   * ================================================================ */

  /**
   * 切换点赞状态（点赞/取消）
   * 
   * @param {number} userId - 用户ID
   * @param {string} targetType - 'post' 或 'reply'
   * @param {number} targetId - 目标ID
   * @returns {Object} { liked: boolean } 操作后的状态
   */
  static async toggleLike(userId, targetType, targetId) {
    try {
      /* 先检查是否已点赞 */
      const checkSql = `
        SELECT id FROM forum_likes
        WHERE user_id = ? AND target_type = ? AND target_id = ?
        LIMIT 1
      `;
      const { rows: existing } = await dbConnection.query(checkSql, [userId, targetType, targetId]);

      if (existing.length > 0) {
        /* 已点赞 → 取消 */
        await dbConnection.query('DELETE FROM forum_likes WHERE id = ?', [existing[0].id]);

        /* 减少目标的 like_count */
        const table = targetType === 'post' ? 'forum_posts' : 'forum_replies';
        await dbConnection.query(
          `UPDATE ${table} SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?`,
          [targetId]
        );

        return { liked: false };
      } else {
        /* 未点赞 → 点赞 */
        await dbConnection.query(
          'INSERT INTO forum_likes (user_id, target_type, target_id) VALUES (?, ?, ?)',
          [userId, targetType, targetId]
        );

        /* 增加目标的 like_count */
        const table = targetType === 'post' ? 'forum_posts' : 'forum_replies';
        await dbConnection.query(
          `UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`,
          [targetId]
        );

        return { liked: true };
      }
    } catch (error) {
      /* 唯一键冲突说明并发重复，视为已点赞 */
      if (error.code === 'ER_DUP_ENTRY') {
        return { liked: true };
      }
      logger.error('切换点赞失败:', { userId, targetType, targetId, error: error.message });
      throw new DatabaseError('点赞操作失败', error);
    }
  }

  /* ================================================================
   * 收藏
   * ================================================================ */

  /**
   * 切换收藏状态（收藏/取消）
   * 
   * @param {number} userId - 用户ID
   * @param {number} postId - 帖子ID
   * @returns {Object} { favorited: boolean }
   */
  static async toggleFavorite(userId, postId) {
    try {
      const checkSql = `
        SELECT id FROM forum_favorites
        WHERE user_id = ? AND post_id = ?
        LIMIT 1
      `;
      const { rows: existing } = await dbConnection.query(checkSql, [userId, postId]);

      if (existing.length > 0) {
        await dbConnection.query('DELETE FROM forum_favorites WHERE id = ?', [existing[0].id]);
        await dbConnection.query(
          'UPDATE forum_posts SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?',
          [postId]
        );
        return { favorited: false };
      } else {
        await dbConnection.query(
          'INSERT INTO forum_favorites (user_id, post_id) VALUES (?, ?)',
          [userId, postId]
        );
        await dbConnection.query(
          'UPDATE forum_posts SET favorite_count = favorite_count + 1 WHERE id = ?',
          [postId]
        );
        return { favorited: true };
      }
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return { favorited: true };
      }
      logger.error('切换收藏失败:', { userId, postId, error: error.message });
      throw new DatabaseError('收藏操作失败', error);
    }
  }

  /**
   * 获取用户收藏的帖子列表（分页）
   * 
   * @param {number} userId - 用户ID
   * @param {Object} options - 分页选项
   * @returns {Object} { items, pagination }
   */
  static async getUserFavorites(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const safePage = Math.max(1, parseInt(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
      const offset = (safePage - 1) * safeLimit;

      const countSql = `
        SELECT COUNT(*) as total
        FROM forum_favorites ff
        JOIN forum_posts p ON ff.post_id = p.id
        WHERE ff.user_id = ? AND p.deleted_at IS NULL
      `;
      const { rows: countRows } = await dbConnection.query(countSql, [userId]);
      const total = countRows[0].total;

      const dataSql = `
        SELECT p.*, u.username AS author_name, b.name AS board_name,
               1 AS is_favorited
        FROM forum_favorites ff
        JOIN forum_posts p ON ff.post_id = p.id
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN forum_boards b ON p.board_id = b.id
        WHERE ff.user_id = ? AND p.deleted_at IS NULL
        ORDER BY ff.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows } = await dbConnection.simpleQuery(dataSql, [userId, safeLimit, offset]);

      return {
        items: rows,
        pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) }
      };
    } catch (error) {
      logger.error('获取收藏列表失败:', { userId, error: error.message });
      throw new DatabaseError('获取收藏列表失败', error);
    }
  }
}

module.exports = ForumLikeService;
