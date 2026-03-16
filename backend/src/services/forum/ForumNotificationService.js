/**
 * 论坛通知服务
 * 
 * 处理论坛相关通知的创建、查询、标记已读等操作
 * 通知类型：
 * - mention: @提及通知
 * - reply:   回复通知（有人回复了你的帖子或评论）
 * - like:    点赞通知
 * - system:  系统通知（帖子被置顶/精华/锁定等）
 * 
 * @提及解析：
 * 从Markdown内容中提取 @username 模式，查表确认用户存在后创建通知
 * 
 * @module services/forum/ForumNotificationService
 */

const dbConnection = require('../../database/connection');
const { DatabaseError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/* @用户名 正则：匹配 @后跟1-50个非空白字符 */
const MENTION_REGEX = /@([^\s@]{1,50})/g;

class ForumNotificationService {

  /**
   * 创建通知
   * 
   * @param {Object} data - 通知数据
   * @param {number} data.user_id - 接收人
   * @param {number} data.sender_id - 触发人
   * @param {string} data.type - 类型 mention/reply/like/system
   * @param {number} data.post_id - 关联帖子
   * @param {number} data.reply_id - 关联回复
   * @param {string} data.content - 通知摘要
   * @param {Object} data.extra_data - 扩展数据
   * @returns {number} 通知ID
   */
  static async create(data) {
    try {
      /* 不给自己发通知 */
      if (data.user_id === data.sender_id) return null;

      const sql = `
        INSERT INTO forum_notifications
        (user_id, sender_id, type, post_id, reply_id, content, extra_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const { rows } = await dbConnection.query(sql, [
        data.user_id,
        data.sender_id,
        data.type,
        data.post_id || null,
        data.reply_id || null,
        (data.content || '').substring(0, 500),
        data.extra_data ? JSON.stringify(data.extra_data) : null
      ]);

      return rows.insertId;
    } catch (error) {
      /* 通知创建失败不应阻塞主流程 */
      logger.warn('创建通知失败:', { data, error: error.message });
      return null;
    }
  }

  /**
   * 解析内容中的 @提及 并批量创建通知
   * 
   * @param {string} content - Markdown内容
   * @param {number} senderId - 发送人ID
   * @param {number} postId - 帖子ID
   * @param {number|null} replyId - 回复ID
   * @param {Object} extraData - 扩展数据（帖子标题等）
   * @returns {string[]} 被提及的用户名列表
   */
  static async processMentions(content, senderId, postId, replyId = null, extraData = {}) {
    try {
      if (!content) return [];

      /* 提取所有 @username */
      const mentions = [];
      let match;
      while ((match = MENTION_REGEX.exec(content)) !== null) {
        const username = match[1];
        if (!mentions.includes(username)) {
          mentions.push(username);
        }
      }

      if (mentions.length === 0) return [];

      /* 批量查询用户是否存在（最多处理20个@） */
      const limitedMentions = mentions.slice(0, 20);
      const placeholders = limitedMentions.map(() => '?').join(', ');
      const sql = `SELECT id, username FROM users WHERE username IN (${placeholders}) AND status = 'active'`;
      const { rows: users } = await dbConnection.simpleQuery(sql, limitedMentions);

      /* 为每个存在的用户创建通知 */
      const notifiedUsernames = [];
      for (const user of users) {
        await this.create({
          user_id: user.id,
          sender_id: senderId,
          type: 'mention',
          post_id: postId,
          reply_id: replyId,
          content: `在帖子中提到了你`,
          extra_data: { ...extraData, mentioned_username: user.username }
        });
        notifiedUsernames.push(user.username);
      }

      if (notifiedUsernames.length > 0) {
        logger.info('处理@提及通知', { senderId, postId, mentionedUsers: notifiedUsernames });
      }

      return notifiedUsernames;
    } catch (error) {
      logger.warn('处理@提及失败:', { senderId, postId, error: error.message });
      return [];
    }
  }

  /**
   * 创建回复通知（通知帖子作者 + 被引用回复的作者）
   * 
   * @param {Object} reply - 回复对象
   * @param {Object} post - 帖子对象
   * @param {string} senderName - 回复人用户名
   */
  static async onReplyCreated(reply, post, senderName) {
    try {
      const extraData = {
        post_title: (post.title || '').substring(0, 100),
        sender_name: senderName
      };

      /* 通知帖子作者 */
      await this.create({
        user_id: post.user_id,
        sender_id: reply.user_id,
        type: 'reply',
        post_id: post.id,
        reply_id: reply.id,
        content: `${senderName} 回复了你的帖子「${extraData.post_title}」`,
        extra_data: extraData
      });

      /* 如果是楼中楼回复，还需通知被引用回复的作者 */
      if (reply.reply_to_user_id && reply.reply_to_user_id !== post.user_id) {
        await this.create({
          user_id: reply.reply_to_user_id,
          sender_id: reply.user_id,
          type: 'reply',
          post_id: post.id,
          reply_id: reply.id,
          content: `${senderName} 回复了你的评论`,
          extra_data: extraData
        });
      }
    } catch (error) {
      logger.warn('创建回复通知失败:', { replyId: reply.id, error: error.message });
    }
  }

  /**
   * 创建点赞通知
   * 
   * @param {string} targetType - 'post' 或 'reply'
   * @param {number} targetOwnerId - 被点赞内容的作者ID
   * @param {number} senderId - 点赞人ID
   * @param {string} senderName - 点赞人用户名
   * @param {number} postId - 关联帖子ID
   * @param {string} postTitle - 帖子标题
   */
  static async onLiked(targetType, targetOwnerId, senderId, senderName, postId, postTitle) {
    try {
      const typeLabel = targetType === 'post' ? '帖子' : '评论';
      await this.create({
        user_id: targetOwnerId,
        sender_id: senderId,
        type: 'like',
        post_id: postId,
        content: `${senderName} 赞了你的${typeLabel}`,
        extra_data: { post_title: (postTitle || '').substring(0, 100), sender_name: senderName }
      });
    } catch (error) {
      logger.warn('创建点赞通知失败:', error.message);
    }
  }

  /* ================================================================
   * 通知查询与管理
   * ================================================================ */

  /**
   * 获取用户的通知列表（分页）
   * 
   * @param {number} userId - 用户ID
   * @param {Object} options - 分页选项
   * @returns {Object} { items, pagination, unreadCount }
   */
  static async getUserNotifications(userId, options = {}) {
    try {
      const { page = 1, limit = 20, type = null } = options;
      const safePage = Math.max(1, parseInt(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
      const offset = (safePage - 1) * safeLimit;

      /* 条件 */
      const conditions = ['n.user_id = ?'];
      const params = [userId];
      if (type) {
        conditions.push('n.type = ?');
        params.push(type);
      }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      /* COUNT */
      const countSql = `SELECT COUNT(*) as total FROM forum_notifications n ${whereClause}`;
      const { rows: countRows } = await dbConnection.simpleQuery(countSql, params);
      const total = countRows[0].total;

      /* 未读数（全量，不受type过滤） */
      const unreadSql = 'SELECT COUNT(*) as cnt FROM forum_notifications WHERE user_id = ? AND is_read = 0';
      const { rows: unreadRows } = await dbConnection.query(unreadSql, [userId]);
      const unreadCount = unreadRows[0].cnt;

      /* 数据 */
      const dataSql = `
        SELECT n.*,
               s.username AS sender_name
        FROM forum_notifications n
        LEFT JOIN users s ON n.sender_id = s.id
        ${whereClause}
        ORDER BY n.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows } = await dbConnection.simpleQuery(dataSql, [...params, safeLimit, offset]);

      /* 自动解析 extra_data JSON */
      const items = rows.map(row => {
        if (row.extra_data && typeof row.extra_data === 'string') {
          try { row.extra_data = JSON.parse(row.extra_data); } catch { row.extra_data = null; }
        }
        return row;
      });

      return {
        items,
        pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
        unreadCount
      };
    } catch (error) {
      logger.error('获取通知列表失败:', { userId, error: error.message });
      throw new DatabaseError('获取通知列表失败', error);
    }
  }

  /**
   * 获取未读通知数
   * 
   * @param {number} userId - 用户ID
   * @returns {number} 未读数
   */
  static async getUnreadCount(userId) {
    try {
      const sql = 'SELECT COUNT(*) as cnt FROM forum_notifications WHERE user_id = ? AND is_read = 0';
      const { rows } = await dbConnection.query(sql, [userId]);
      return rows[0].cnt;
    } catch (error) {
      logger.warn('获取未读通知数失败:', { userId, error: error.message });
      return 0;
    }
  }

  /**
   * 标记全部已读
   * 
   * @param {number} userId - 用户ID
   * @returns {number} 更新的记录数
   */
  static async markAllRead(userId) {
    try {
      const sql = 'UPDATE forum_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0';
      const { rows } = await dbConnection.query(sql, [userId]);
      return rows.affectedRows;
    } catch (error) {
      logger.error('标记全部已读失败:', { userId, error: error.message });
      throw new DatabaseError('标记全部已读失败', error);
    }
  }

  /**
   * 标记单条已读
   * 
   * @param {number} notificationId - 通知ID
   * @param {number} userId - 用户ID（安全校验）
   */
  static async markRead(notificationId, userId) {
    try {
      const sql = 'UPDATE forum_notifications SET is_read = 1 WHERE id = ? AND user_id = ?';
      await dbConnection.query(sql, [notificationId, userId]);
    } catch (error) {
      logger.warn('标记已读失败:', { notificationId, userId, error: error.message });
    }
  }
}

module.exports = ForumNotificationService;
