/**
 * 论坛版块模型
 * 
 * 版块是论坛的顶级分类，支持两种可见范围：
 * - public:  全平台所有用户可见（跨组）
 * - group:   仅指定组的成员可见（组隔离）
 * 
 * 权限说明：
 * - 超级管理员可以管理所有版块
 * - 组管理员对 visibility=group 的本组版块自动拥有版主权限
 * 
 * @module models/forum/ForumBoard
 */

const BaseModel = require('./BaseModel');
const dbConnection = require('../../database/connection');
const { DatabaseError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class ForumBoard extends BaseModel {
  /* ================================================================
   * 元信息声明
   * ================================================================ */

  static get tableName() { return 'forum_boards'; }
  static get softDelete() { return false; }
  static get jsonColumns() { return ['allowed_group_ids']; }

  /* ================================================================
   * 查询方法
   * ================================================================ */

  /**
   * 获取用户可见的版块列表
   * 
   * 可见规则：
   * 1. visibility = 'public' → 所有人可见
   * 2. visibility = 'group'  → 用户所在组在 allowed_group_ids 中
   * 3. 超级管理员 → 所有版块可见
   * 
   * @param {Object} user - 用户信息 { id, group_id, role }
   * @returns {Object[]} 版块列表（含版主信息）
   */
  static async getVisibleBoards(user) {
    try {
      const { group_id, role } = user;
      let sql;
      let params;

      if (role === 'super_admin') {
        /* 超管看到所有版块（包括未激活的） */
        sql = `
          SELECT b.*,
                 u.username AS creator_name
          FROM forum_boards b
          LEFT JOIN users u ON b.created_by = u.id
          ORDER BY b.sort_order ASC, b.id ASC
        `;
        params = [];
      } else {
        /* 普通用户/组管理员：只看激活的、且有权限的版块 */
        sql = `
          SELECT b.*,
                 u.username AS creator_name
          FROM forum_boards b
          LEFT JOIN users u ON b.created_by = u.id
          WHERE b.is_active = 1
            AND (
              b.visibility = 'public'
              OR (b.visibility = 'group' AND JSON_CONTAINS(b.allowed_group_ids, CAST(? AS JSON)))
            )
          ORDER BY b.sort_order ASC, b.id ASC
        `;
        params = [group_id];
      }

      const { rows } = await dbConnection.simpleQuery(sql, params);
      return rows.map(row => this._parseRow(row));
    } catch (error) {
      logger.error('获取可见版块列表失败:', error);
      throw new DatabaseError('获取版块列表失败', error);
    }
  }

  /**
   * 获取版块详情（含版主列表和统计）
   * 
   * @param {number} boardId - 版块ID
   * @returns {Object|null} 版块详情
   */
  static async getDetail(boardId) {
    try {
      /* 查询版块基本信息 */
      const board = await this.findById(boardId);
      if (!board) return null;

      /* 查询版主列表 */
      const modSql = `
        SELECT fm.*, u.username, u.email
        FROM forum_moderators fm
        JOIN users u ON fm.user_id = u.id
        WHERE fm.board_id = ?
        ORDER BY fm.created_at ASC
      `;
      const { rows: moderators } = await dbConnection.query(modSql, [boardId]);
      board.moderators = moderators;

      return board;
    } catch (error) {
      logger.error('获取版块详情失败:', { boardId, error: error.message });
      throw new DatabaseError('获取版块详情失败', error);
    }
  }

  /**
   * 检查用户是否有权访问指定版块
   * 
   * @param {number} boardId - 版块ID
   * @param {Object} user - 用户信息 { id, group_id, role }
   * @returns {Object} { hasAccess: boolean, board: Object|null }
   */
  static async checkAccess(boardId, user) {
    try {
      const board = await this.findById(boardId);
      if (!board) return { hasAccess: false, board: null };
      if (!board.is_active && user.role !== 'super_admin') {
        return { hasAccess: false, board };
      }
      if (user.role === 'super_admin') return { hasAccess: true, board };

      if (board.visibility === 'public') {
        return { hasAccess: true, board };
      }

      /* group 模式：检查用户组是否在允许列表中 */
      const allowedIds = board.allowed_group_ids || [];
      const hasAccess = allowedIds.includes(user.group_id);
      return { hasAccess, board };
    } catch (error) {
      logger.error('检查版块访问权限失败:', { boardId, error: error.message });
      return { hasAccess: false, board: null };
    }
  }

  /**
   * 更新版块帖子计数和最后发帖时间（发帖时调用）
   * 
   * @param {number} boardId - 版块ID
   */
  static async onNewPost(boardId) {
    try {
      const sql = `
        UPDATE forum_boards
        SET post_count = post_count + 1,
            last_post_at = NOW()
        WHERE id = ?
      `;
      await dbConnection.query(sql, [boardId]);
    } catch (error) {
      logger.warn('更新版块计数失败:', { boardId, error: error.message });
    }
  }

  /**
   * 帖子删除时减少计数
   * 
   * @param {number} boardId - 版块ID
   */
  static async onPostDeleted(boardId) {
    try {
      const sql = `
        UPDATE forum_boards
        SET post_count = GREATEST(post_count - 1, 0)
        WHERE id = ?
      `;
      await dbConnection.query(sql, [boardId]);
    } catch (error) {
      logger.warn('减少版块计数失败:', { boardId, error: error.message });
    }
  }
}

module.exports = ForumBoard;
