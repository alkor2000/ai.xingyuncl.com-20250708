/**
 * 论坛帖子模型
 * 
 * 帖子属于某个版块，支持五种独立管理状态：
 * - is_pinned:         置顶
 * - is_featured:       精华
 * - is_hidden:         隐藏（列表不可见，仅管理员可查看）
 * - is_locked:         锁定（列表可见但内容遮蔽）
 * - is_reply_disabled: 禁止回复
 * 
 * 编辑规则：
 * - 发帖后30分钟内编辑不增加 edit_count
 * - 30分钟后编辑会标记"已编辑"
 * 
 * @module models/forum/ForumPost
 */

const BaseModel = require('./BaseModel');
const dbConnection = require('../../database/connection');
const { DatabaseError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/* 30分钟自由编辑窗口（毫秒） */
const FREE_EDIT_WINDOW_MS = 30 * 60 * 1000;

class ForumPost extends BaseModel {
  /* ================================================================
   * 元信息声明
   * ================================================================ */

  static get tableName() { return 'forum_posts'; }
  static get softDelete() { return true; }
  static get jsonColumns() { return []; }

  /* ================================================================
   * 帖子列表查询
   * ================================================================ */

  /**
   * 获取版块帖子列表（分页，用户视角）
   * 
   * 排序策略：置顶帖优先，然后按排序模式排列
   * 隐藏帖对普通用户不可见，锁定帖可见但内容遮蔽
   * 
   * @param {number} boardId - 版块ID
   * @param {Object} options - 分页与排序选项
   * @param {number} options.page - 页码
   * @param {number} options.limit - 每页数量
   * @param {string} options.sort - 排序模式: latest/active/hot
   * @param {number|null} options.userId - 当前用户ID（用于获取点赞/收藏状态）
   * @param {boolean} options.showHidden - 是否显示隐藏帖（版主/管理员用）
   * @returns {Object} { items, pagination }
   */
  static async getListByBoard(boardId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sort = 'active',
        userId = null,
        showHidden = false
      } = options;

      const safePage = Math.max(1, parseInt(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
      const offset = (safePage - 1) * safeLimit;

      /* WHERE 条件 */
      const conditions = ['p.board_id = ?', 'p.deleted_at IS NULL'];
      const params = [boardId];

      if (!showHidden) {
        conditions.push('p.is_hidden = 0');
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      /* 排序策略 */
      let orderBy;
      switch (sort) {
        case 'latest':
          orderBy = 'p.is_pinned DESC, p.created_at DESC';
          break;
        case 'hot':
          orderBy = 'p.is_pinned DESC, (p.reply_count + p.like_count * 2) DESC, p.created_at DESC';
          break;
        case 'active':
        default:
          orderBy = 'p.is_pinned DESC, COALESCE(p.last_reply_at, p.created_at) DESC';
          break;
      }

      /* COUNT */
      const countSql = `SELECT COUNT(*) as total FROM forum_posts p ${whereClause}`;
      const { rows: countRows } = await dbConnection.simpleQuery(countSql, params);
      const total = countRows[0].total;

      /* 数据查询 - JOIN 用户表获取作者信息 + 可选的点赞/收藏状态 */
      let selectFields = `
        p.*,
        u.username AS author_name,
        last_u.username AS last_reply_username
      `;

      let joins = `
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN users last_u ON p.last_reply_user_id = last_u.id
      `;

      if (userId) {
        selectFields += `,
          IF(fl.id IS NOT NULL, 1, 0) AS is_liked,
          IF(ff.id IS NOT NULL, 1, 0) AS is_favorited
        `;
        joins += `
          LEFT JOIN forum_likes fl ON fl.target_type = 'post' AND fl.target_id = p.id AND fl.user_id = ?
          LEFT JOIN forum_favorites ff ON ff.post_id = p.id AND ff.user_id = ?
        `;
        params.unshift(userId, userId);
      }

      const dataSql = `
        SELECT ${selectFields}
        FROM forum_posts p
        ${joins}
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `;

      const { rows } = await dbConnection.simpleQuery(dataSql, [...params, safeLimit, offset]);

      /* 锁定帖遮蔽内容 */
      const items = rows.map(row => {
        if (row.is_locked) {
          row.content = null;
          row._locked_notice = '该帖子已被管理员锁定';
        }
        return row;
      });

      return {
        items,
        pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) }
      };
    } catch (error) {
      logger.error('获取版块帖子列表失败:', { boardId, error: error.message });
      throw new DatabaseError('获取帖子列表失败', error);
    }
  }

  /**
   * 获取帖子详情（含作者信息和当前用户互动状态）
   * 
   * @param {number} postId - 帖子ID
   * @param {number|null} userId - 当前用户ID
   * @returns {Object|null} 帖子详情
   */
  static async getDetail(postId, userId = null) {
    try {
      let selectFields = `
        p.*,
        u.username AS author_name,
        u.email AS author_email,
        b.name AS board_name,
        b.visibility AS board_visibility
      `;

      let joins = `
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN forum_boards b ON p.board_id = b.id
      `;
      const params = [postId];

      if (userId) {
        selectFields += `,
          IF(fl.id IS NOT NULL, 1, 0) AS is_liked,
          IF(ff.id IS NOT NULL, 1, 0) AS is_favorited
        `;
        joins += `
          LEFT JOIN forum_likes fl ON fl.target_type = 'post' AND fl.target_id = p.id AND fl.user_id = ?
          LEFT JOIN forum_favorites ff ON ff.post_id = p.id AND ff.user_id = ?
        `;
        params.unshift(userId, userId);
      }

      const sql = `
        SELECT ${selectFields}
        FROM forum_posts p
        ${joins}
        WHERE p.id = ? AND p.deleted_at IS NULL
        LIMIT 1
      `;
      const { rows } = await dbConnection.simpleQuery(sql, params);

      if (rows.length === 0) return null;

      const post = rows[0];
      /* 锁定帖遮蔽内容（版主/管理员在Controller层另行处理） */
      if (post.is_locked) {
        post._locked_notice = '该帖子已被管理员锁定';
      }

      return post;
    } catch (error) {
      logger.error('获取帖子详情失败:', { postId, error: error.message });
      throw new DatabaseError('获取帖子详情失败', error);
    }
  }

  /**
   * 获取用户的帖子列表
   * 
   * @param {number} userId - 用户ID
   * @param {Object} options - 分页选项
   * @returns {Object} { items, pagination }
   */
  static async getListByUser(userId, options = {}) {
    return this.paginate(
      { user_id: userId },
      {
        ...options,
        select: `forum_posts.*, b.name AS board_name`,
        joins: 'LEFT JOIN forum_boards b ON forum_posts.board_id = b.id',
        orderBy: 'forum_posts.created_at DESC'
      }
    );
  }

  /**
   * 获取热帖推荐（跨版块）
   * 
   * @param {Object} user - 用户信息（用于权限过滤）
   * @param {number} limit - 返回数量
   * @returns {Object[]} 热帖列表
   */
  static async getHotPosts(user, limit = 10) {
    try {
      const safeLimit = Math.min(20, Math.max(1, parseInt(limit) || 10));

      let boardFilter;
      let params;

      if (user.role === 'super_admin') {
        boardFilter = '';
        params = [];
      } else {
        boardFilter = `
          AND b.is_active = 1
          AND (
            b.visibility = 'public'
            OR (b.visibility = 'group' AND JSON_CONTAINS(b.allowed_group_ids, CAST(? AS JSON)))
          )
        `;
        params = [user.group_id];
      }

      const sql = `
        SELECT p.*, 
               u.username AS author_name,
               b.name AS board_name
        FROM forum_posts p
        JOIN forum_boards b ON p.board_id = b.id
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.deleted_at IS NULL
          AND p.is_hidden = 0
          AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          ${boardFilter}
        ORDER BY (p.reply_count + p.like_count * 2 + p.view_count * 0.1) DESC
        LIMIT ?
      `;
      const { rows } = await dbConnection.simpleQuery(sql, [...params, safeLimit]);
      return rows;
    } catch (error) {
      logger.error('获取热帖失败:', error);
      throw new DatabaseError('获取热帖失败', error);
    }
  }

  /* ================================================================
   * 写入与编辑
   * ================================================================ */

  /**
   * 发布新帖子
   * 
   * @param {Object} data - 帖子数据
   * @param {Object} user - 发帖用户 { id, group_id }
   * @param {string} ipAddress - 客户端IP
   * @returns {Object} 新帖子记录
   */
  static async createPost(data, user, ipAddress = null) {
    try {
      const { title, content, board_id } = data;

      if (!title || !title.trim()) throw new ValidationError('标题不能为空');
      if (!content || !content.trim()) throw new ValidationError('内容不能为空');
      if (!board_id) throw new ValidationError('必须指定版块');

      const post = await this.create({
        board_id,
        user_id: user.id,
        group_id: user.group_id || null,
        title: title.trim().substring(0, 200),
        content: content.trim(),
        ip_address: ipAddress
      });

      /* 更新版块计数 */
      const ForumBoard = require('./ForumBoard');
      await ForumBoard.onNewPost(board_id);

      return post;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('发布帖子失败:', error);
      throw new DatabaseError('发布帖子失败', error);
    }
  }

  /**
   * 编辑帖子（带30分钟自由编辑窗口）
   * 
   * @param {number} postId - 帖子ID
   * @param {Object} data - 更新数据 { title?, content? }
   * @returns {Object} 更新后的帖子
   */
  static async editPost(postId, data) {
    try {
      const post = await this.findById(postId);
      if (!post) throw new ValidationError('帖子不存在');

      const updateData = {};
      if (data.title !== undefined) {
        updateData.title = data.title.trim().substring(0, 200);
      }
      if (data.content !== undefined) {
        updateData.content = data.content.trim();
      }

      /* 30分钟自由编辑窗口判断 */
      const elapsed = Date.now() - new Date(post.created_at).getTime();
      if (elapsed > FREE_EDIT_WINDOW_MS) {
        updateData.edit_count = (post.edit_count || 0) + 1;
        updateData.last_edited_at = new Date();
      }

      return await this.updateById(postId, updateData);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('编辑帖子失败:', { postId, error: error.message });
      throw new DatabaseError('编辑帖子失败', error);
    }
  }

  /* ================================================================
   * 管理操作（版主/管理员）
   * ================================================================ */

  /**
   * 切换帖子管理状态（通用方法）
   * 
   * @param {number} postId - 帖子ID
   * @param {string} field - 状态字段名
   * @returns {Object} 更新后的帖子
   */
  static async toggleStatus(postId, field) {
    const allowedFields = ['is_pinned', 'is_featured', 'is_hidden', 'is_locked', 'is_reply_disabled'];
    if (!allowedFields.includes(field)) {
      throw new ValidationError(`不支持的状态字段: ${field}`);
    }

    try {
      const sql = `
        UPDATE ${this.tableName}
        SET ${field} = NOT ${field}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
      `;
      await dbConnection.query(sql, [postId]);
      logger.info('帖子状态切换', { postId, field });

      return await this.findById(postId);
    } catch (error) {
      logger.error('切换帖子状态失败:', { postId, field, error: error.message });
      throw new DatabaseError('切换帖子状态失败', error);
    }
  }

  /* ================================================================
   * 浏览量（防刷由Controller层配合Redis实现）
   * ================================================================ */

  /**
   * 增加浏览量
   * 
   * @param {number} postId - 帖子ID
   */
  static async incrementViewCount(postId) {
    await this.increment(postId, 'view_count', 1);
  }
}

module.exports = ForumPost;
