/**
 * 论坛版主权限服务
 * 
 * 集中管理三种来源的版主权限判断：
 * 1. 超级管理员 → 全局最高权限
 * 2. 组管理员 → 对 visibility=group 的本组版块自动拥有版主权限
 * 3. forum_moderators 表中明确指定的版主
 * 
 * 权限层级（从高到低）：
 *   super_admin > auto_moderator(组管理员) > appointed_moderator(指定版主) > author > user
 * 
 * @module services/forum/ForumModeratorService
 */

const dbConnection = require('../../database/connection');
const { ForumBoard } = require('../../models/forum');
const { DatabaseError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class ForumModeratorService {

  /**
   * 判断用户在指定版块是否拥有版主权限
   * 
   * @param {number} userId - 用户ID
   * @param {number} boardId - 版块ID
   * @param {Object} user - 用户对象 { id, role, group_id }
   * @returns {Object} { isModerator: boolean, source: string }
   *   source: 'super_admin' | 'group_admin' | 'appointed' | 'none'
   */
  static async checkModeratorPermission(userId, boardId, user) {
    try {
      /* 1. 超级管理员 - 全局版主 */
      if (user.role === 'super_admin') {
        return { isModerator: true, source: 'super_admin' };
      }

      /* 获取版块信息 */
      const board = await ForumBoard.findById(boardId);
      if (!board) {
        return { isModerator: false, source: 'none' };
      }

      /* 2. 组管理员自动版主 - 仅对 group 类型且本组版块生效 */
      if (user.role === 'admin' && board.visibility === 'group') {
        const allowedIds = board.allowed_group_ids || [];
        if (allowedIds.includes(user.group_id)) {
          return { isModerator: true, source: 'group_admin' };
        }
      }

      /* 3. 明确指定的版主 */
      const sql = `
        SELECT id FROM forum_moderators
        WHERE board_id = ? AND user_id = ?
        LIMIT 1
      `;
      const { rows } = await dbConnection.query(sql, [boardId, userId]);
      if (rows.length > 0) {
        return { isModerator: true, source: 'appointed' };
      }

      return { isModerator: false, source: 'none' };
    } catch (error) {
      logger.error('检查版主权限失败:', { userId, boardId, error: error.message });
      return { isModerator: false, source: 'none' };
    }
  }

  /**
   * 判断用户是否可以管理指定帖子
   * 
   * 可管理 = 版主权限 OR 帖子作者
   * 
   * @param {number} userId - 用户ID
   * @param {Object} post - 帖子对象（需含 board_id, user_id）
   * @param {Object} user - 用户对象
   * @returns {Object} { canManage, isModerator, isAuthor }
   */
  static async canManagePost(userId, post, user) {
    const isAuthor = post.user_id === userId;
    const { isModerator } = await this.checkModeratorPermission(userId, post.board_id, user);

    return {
      canManage: isModerator || isAuthor,
      isModerator,
      isAuthor
    };
  }

  /**
   * 判断用户是否可以管理指定回复
   * 
   * @param {number} userId - 用户ID
   * @param {Object} reply - 回复对象（需含 user_id）
   * @param {number} boardId - 版块ID
   * @param {Object} user - 用户对象
   * @returns {Object} { canManage, isModerator, isAuthor }
   */
  static async canManageReply(userId, reply, boardId, user) {
    const isAuthor = reply.user_id === userId;
    const { isModerator } = await this.checkModeratorPermission(userId, boardId, user);

    return {
      canManage: isModerator || isAuthor,
      isModerator,
      isAuthor
    };
  }

  /* ================================================================
   * 版主管理（超管操作）
   * ================================================================ */

  /**
   * 获取版块的版主列表
   * 
   * @param {number} boardId - 版块ID
   * @returns {Object[]} 版主列表（含用户信息）
   */
  static async getModeratorsByBoard(boardId) {
    try {
      const sql = `
        SELECT fm.id, fm.board_id, fm.user_id, fm.appointed_by, fm.created_at,
               u.username, u.email,
               ab.username AS appointed_by_name
        FROM forum_moderators fm
        JOIN users u ON fm.user_id = u.id
        LEFT JOIN users ab ON fm.appointed_by = ab.id
        WHERE fm.board_id = ?
        ORDER BY fm.created_at ASC
      `;
      const { rows } = await dbConnection.query(sql, [boardId]);
      return rows;
    } catch (error) {
      logger.error('获取版主列表失败:', { boardId, error: error.message });
      throw new DatabaseError('获取版主列表失败', error);
    }
  }

  /**
   * 指定版主
   * 
   * @param {number} boardId - 版块ID
   * @param {number} userId - 被指定用户ID
   * @param {number} appointedBy - 操作人ID（超管）
   * @returns {boolean} 是否成功
   */
  static async appointModerator(boardId, userId, appointedBy) {
    try {
      const sql = `
        INSERT INTO forum_moderators (board_id, user_id, appointed_by)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE appointed_by = ?, created_at = CURRENT_TIMESTAMP
      `;
      await dbConnection.query(sql, [boardId, userId, appointedBy, appointedBy]);

      logger.info('指定版主成功', { boardId, userId, appointedBy });
      return true;
    } catch (error) {
      logger.error('指定版主失败:', { boardId, userId, error: error.message });
      throw new DatabaseError('指定版主失败', error);
    }
  }

  /**
   * 移除版主
   * 
   * @param {number} moderatorId - forum_moderators 表主键
   * @returns {boolean} 是否成功
   */
  static async removeModerator(moderatorId) {
    try {
      const sql = 'DELETE FROM forum_moderators WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [moderatorId]);
      const success = rows.affectedRows > 0;

      if (success) {
        logger.info('移除版主成功', { moderatorId });
      }
      return success;
    } catch (error) {
      logger.error('移除版主失败:', { moderatorId, error: error.message });
      throw new DatabaseError('移除版主失败', error);
    }
  }
}

module.exports = ForumModeratorService;
