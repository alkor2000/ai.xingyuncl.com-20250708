/**
 * 论坛控制器 v2.1
 * 
 * 修复：
 * - 新增 deleteAttachment 方法（删除单个附件+磁盘文件清理）
 * - deletePost 时联动清理帖子附件
 * - deleteReply 时联动清理回复附件
 * 
 * @module controllers/ForumController
 */

const { ForumBoard, ForumPost, ForumReply, ForumAttachment } = require('../models/forum');
const { ForumModeratorService, ForumNotificationService, ForumLikeService } = require('../services/forum');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const redisConnection = require('../database/redis');
const dbConnection = require('../database/connection');
const config = require('../config');
const path = require('path');
const fs = require('fs').promises;

/* 浏览量防刷间隔（秒） */
const VIEW_COOLDOWN_SECONDS = 900;

/**
 * 清理磁盘上的附件文件（内部工具方法）
 * @param {Object[]} attachments - 附件记录数组
 */
const cleanupAttachmentFiles = async (attachments) => {
  for (const att of attachments) {
    try {
      const filePath = path.join(config.upload.uploadDir, att.file_path);
      await fs.unlink(filePath);
      logger.info('附件文件已删除', { id: att.id, path: att.file_path });
    } catch (err) {
      /* 文件不存在不报错 */
      if (err.code !== 'ENOENT') {
        logger.warn('附件文件删除失败', { id: att.id, path: att.file_path, error: err.message });
      }
    }
    /* 删除缩略图 */
    if (att.thumbnail_path) {
      try {
        const thumbPath = path.join(config.upload.uploadDir, att.thumbnail_path);
        await fs.unlink(thumbPath);
      } catch (err) { /* 忽略 */ }
    }
  }
};

const ForumController = {

  /* ================================================================
   * 版块
   * ================================================================ */

  async getBoards(req, res) {
    try {
      const boards = await ForumBoard.getVisibleBoards(req.user);
      ResponseHelper.success(res, boards, '获取版块列表成功');
    } catch (error) {
      logger.error('获取版块列表失败:', error);
      ResponseHelper.error(res, '获取版块列表失败');
    }
  },

  async getBoardPosts(req, res) {
    try {
      const { boardId } = req.params;
      const { page, limit, sort } = req.query;

      const { hasAccess, board } = await ForumBoard.checkAccess(boardId, req.user);
      if (!board) return ResponseHelper.notFound(res, '版块不存在');
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此版块');

      const { isModerator } = await ForumModeratorService.checkModeratorPermission(req.user.id, boardId, req.user);

      const result = await ForumPost.getListByBoard(boardId, {
        page, limit, sort,
        userId: req.user.id,
        showHidden: isModerator
      });

      const postIds = result.items.map(p => p.id);
      const attachmentMap = await ForumAttachment.getByTargetIds('post', postIds);
      result.items.forEach(post => {
        post.attachments = attachmentMap.get(post.id) || [];
      });

      ResponseHelper.paginated(res, result.items, result.pagination, '获取帖子列表成功');
    } catch (error) {
      logger.error('获取版块帖子失败:', error);
      ResponseHelper.error(res, '获取帖子列表失败');
    }
  },

  /* ================================================================
   * 帖子
   * ================================================================ */

  async getHotPosts(req, res) {
    try {
      const { limit } = req.query;
      const posts = await ForumPost.getHotPosts(req.user, limit);
      ResponseHelper.success(res, posts, '获取热帖成功');
    } catch (error) {
      logger.error('获取热帖失败:', error);
      ResponseHelper.error(res, '获取热帖失败');
    }
  },

  async getPostDetail(req, res) {
    try {
      const { id } = req.params;
      const post = await ForumPost.getDetail(id, req.user.id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { hasAccess } = await ForumBoard.checkAccess(post.board_id, req.user);
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此帖子');

      if (post.is_hidden) {
        const { isModerator } = await ForumModeratorService.checkModeratorPermission(req.user.id, post.board_id, req.user);
        if (!isModerator) return ResponseHelper.notFound(res, '帖子不存在');
      }

      if (post.is_locked) {
        const { isModerator } = await ForumModeratorService.checkModeratorPermission(req.user.id, post.board_id, req.user);
        if (!isModerator) {
          post.content = null;
        }
      }

      const viewKey = `forum:view:${id}:${req.user.id}`;
      let shouldCount = true;
      if (redisConnection.isConnected) {
        const viewed = await redisConnection.get(viewKey);
        if (viewed) {
          shouldCount = false;
        } else {
          await redisConnection.set(viewKey, '1', VIEW_COOLDOWN_SECONDS);
        }
      }
      if (shouldCount) {
        await ForumPost.incrementViewCount(id);
      }

      post.attachments = await ForumAttachment.getByTarget('post', id);

      ResponseHelper.success(res, post, '获取帖子详情成功');
    } catch (error) {
      logger.error('获取帖子详情失败:', error);
      ResponseHelper.error(res, '获取帖子详情失败');
    }
  },

  async createPost(req, res) {
    try {
      const { title, content, board_id, attachment_ids } = req.body;

      const { hasAccess, board } = await ForumBoard.checkAccess(board_id, req.user);
      if (!board) return ResponseHelper.notFound(res, '版块不存在');
      if (!hasAccess) return ResponseHelper.forbidden(res, '无权在此版块发帖');

      const ipAddress = req.ip || req.connection?.remoteAddress;
      const post = await ForumPost.createPost({ title, content, board_id }, req.user, ipAddress);

      if (attachment_ids && Array.isArray(attachment_ids)) {
        for (const attId of attachment_ids) {
          await dbConnection.query(
            'UPDATE forum_attachments SET target_type = ?, target_id = ? WHERE id = ? AND user_id = ? AND target_id = 0',
            ['post', post.id, attId, req.user.id]
          );
        }
      }

      await ForumNotificationService.processMentions(
        content, req.user.id, post.id, null,
        { post_title: post.title, board_name: board.name, sender_name: req.user.username }
      );

      ResponseHelper.success(res, post, '发帖成功', 201);
    } catch (error) {
      logger.error('发帖失败:', error);
      ResponseHelper.error(res, error.message || '发帖失败');
    }
  },

  async updatePost(req, res) {
    try {
      const { id } = req.params;
      const post = await ForumPost.findById(id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { canManage } = await ForumModeratorService.canManagePost(req.user.id, post, req.user);
      if (!canManage) return ResponseHelper.forbidden(res, '无权编辑此帖子');

      const updated = await ForumPost.editPost(id, req.body);
      ResponseHelper.success(res, updated, '编辑成功');
    } catch (error) {
      logger.error('编辑帖子失败:', error);
      ResponseHelper.error(res, error.message || '编辑帖子失败');
    }
  },

  /**
   * 删除帖子 - v2.1 联动清理附件
   */
  async deletePost(req, res) {
    try {
      const { id } = req.params;
      const post = await ForumPost.findById(id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { canManage } = await ForumModeratorService.canManagePost(req.user.id, post, req.user);
      if (!canManage) return ResponseHelper.forbidden(res, '无权删除此帖子');

      /* 清理帖子附件(数据库记录+磁盘文件) */
      const postAttachments = await ForumAttachment.deleteByTarget('post', id);
      await cleanupAttachmentFiles(postAttachments);

      /* 清理所有回复的附件 */
      const replySql = 'SELECT id FROM forum_replies WHERE post_id = ? AND deleted_at IS NULL';
      const { rows: replyRows } = await dbConnection.query(replySql, [id]);
      for (const reply of replyRows) {
        const replyAtts = await ForumAttachment.deleteByTarget('reply', reply.id);
        await cleanupAttachmentFiles(replyAtts);
      }

      await ForumPost.deleteById(id);
      await ForumBoard.onPostDeleted(post.board_id);

      ResponseHelper.success(res, null, '删除成功');
    } catch (error) {
      logger.error('删除帖子失败:', error);
      ResponseHelper.error(res, '删除帖子失败');
    }
  },

  async getMyPosts(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await ForumPost.getListByUser(req.user.id, { page, limit });
      ResponseHelper.paginated(res, result.items, result.pagination, '获取我的帖子成功');
    } catch (error) {
      logger.error('获取我的帖子失败:', error);
      ResponseHelper.error(res, '获取我的帖子失败');
    }
  },

  /* ================================================================
   * 回复
   * ================================================================ */

  async getReplies(req, res) {
    try {
      const { postId } = req.params;
      const { page, limit } = req.query;

      const post = await ForumPost.findById(postId);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { isModerator } = await ForumModeratorService.checkModeratorPermission(req.user.id, post.board_id, req.user);

      const result = await ForumReply.getListByPost(postId, {
        page, limit,
        userId: req.user.id,
        showHidden: isModerator
      });

      const replyIds = result.items.map(r => r.id);
      const attachmentMap = await ForumAttachment.getByTargetIds('reply', replyIds);
      result.items.forEach(reply => {
        reply.attachments = attachmentMap.get(reply.id) || [];
      });

      ResponseHelper.paginated(res, result.items, result.pagination, '获取回复列表成功');
    } catch (error) {
      logger.error('获取回复列表失败:', error);
      ResponseHelper.error(res, '获取回复列表失败');
    }
  },

  async createReply(req, res) {
    try {
      const { postId } = req.params;
      const { content, reply_to_id, attachment_ids } = req.body;

      const post = await ForumPost.findById(postId);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');
      if (post.is_reply_disabled) return ResponseHelper.forbidden(res, '该帖子已禁止回复');

      const ipAddress = req.ip || req.connection?.remoteAddress;
      const reply = await ForumReply.createReply(
        { post_id: parseInt(postId), content, reply_to_id },
        req.user, ipAddress
      );

      if (attachment_ids && Array.isArray(attachment_ids)) {
        for (const attId of attachment_ids) {
          await dbConnection.query(
            'UPDATE forum_attachments SET target_type = ?, target_id = ? WHERE id = ? AND user_id = ? AND target_id = 0',
            ['reply', reply.id, attId, req.user.id]
          );
        }
      }

      await ForumNotificationService.onReplyCreated(reply, post, req.user.username);
      await ForumNotificationService.processMentions(
        content, req.user.id, parseInt(postId), reply.id,
        { post_title: post.title, sender_name: req.user.username }
      );

      ResponseHelper.success(res, reply, '回复成功', 201);
    } catch (error) {
      logger.error('发布回复失败:', error);
      ResponseHelper.error(res, error.message || '回复失败');
    }
  },

  async updateReply(req, res) {
    try {
      const { id } = req.params;
      const reply = await ForumReply.findById(id);
      if (!reply) return ResponseHelper.notFound(res, '回复不存在');
      if (reply.user_id !== req.user.id && req.user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '只能编辑自己的回复');
      }
      const updated = await ForumReply.editReply(id, req.body.content);
      ResponseHelper.success(res, updated, '编辑成功');
    } catch (error) {
      logger.error('编辑回复失败:', error);
      ResponseHelper.error(res, error.message || '编辑回复失败');
    }
  },

  /**
   * 删除回复 - v2.1 联动清理附件
   */
  async deleteReply(req, res) {
    try {
      const { id } = req.params;
      const reply = await ForumReply.findById(id);
      if (!reply) return ResponseHelper.notFound(res, '回复不存在');

      const post = await ForumPost.findById(reply.post_id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { canManage } = await ForumModeratorService.canManageReply(req.user.id, reply, post.board_id, req.user);
      if (!canManage) return ResponseHelper.forbidden(res, '无权删除此回复');

      /* v2.1 清理回复附件 */
      const replyAtts = await ForumAttachment.deleteByTarget('reply', id);
      await cleanupAttachmentFiles(replyAtts);

      await ForumReply.deleteReply(id, reply.post_id);
      ResponseHelper.success(res, null, '删除成功');
    } catch (error) {
      logger.error('删除回复失败:', error);
      ResponseHelper.error(res, '删除回复失败');
    }
  },

  /* ================================================================
   * 点赞 / 收藏
   * ================================================================ */

  async togglePostLike(req, res) {
    try {
      const { id } = req.params;
      const post = await ForumPost.findById(id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');
      const result = await ForumLikeService.toggleLike(req.user.id, 'post', id);
      if (result.liked) {
        await ForumNotificationService.onLiked('post', post.user_id, req.user.id, req.user.username, post.id, post.title);
      }
      ResponseHelper.success(res, result, result.liked ? '已点赞' : '已取消点赞');
    } catch (error) {
      logger.error('帖子点赞失败:', error);
      ResponseHelper.error(res, '操作失败');
    }
  },

  async toggleReplyLike(req, res) {
    try {
      const { id } = req.params;
      const reply = await ForumReply.findById(id);
      if (!reply) return ResponseHelper.notFound(res, '回复不存在');
      const result = await ForumLikeService.toggleLike(req.user.id, 'reply', id);
      if (result.liked) {
        const post = await ForumPost.findById(reply.post_id);
        await ForumNotificationService.onLiked('reply', reply.user_id, req.user.id, req.user.username, reply.post_id, post?.title);
      }
      ResponseHelper.success(res, result, result.liked ? '已点赞' : '已取消点赞');
    } catch (error) {
      logger.error('回复点赞失败:', error);
      ResponseHelper.error(res, '操作失败');
    }
  },

  async toggleFavorite(req, res) {
    try {
      const { id } = req.params;
      const post = await ForumPost.findById(id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');
      const result = await ForumLikeService.toggleFavorite(req.user.id, id);
      ResponseHelper.success(res, result, result.favorited ? '已收藏' : '已取消收藏');
    } catch (error) {
      logger.error('收藏操作失败:', error);
      ResponseHelper.error(res, '操作失败');
    }
  },

  async getFavorites(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await ForumLikeService.getUserFavorites(req.user.id, { page, limit });
      ResponseHelper.paginated(res, result.items, result.pagination, '获取收藏列表成功');
    } catch (error) {
      logger.error('获取收藏失败:', error);
      ResponseHelper.error(res, '获取收藏列表失败');
    }
  },

  /* ================================================================
   * 附件上传 + 删除
   * ================================================================ */

  async uploadImages(req, res) {
    try {
      if (!req.files || req.files.length === 0) {
        return ResponseHelper.error(res, '没有上传图片', 400);
      }
      const attachments = [];
      for (const file of req.files) {
        const relativePath = path.relative(config.upload.uploadDir, file.path);
        const att = await ForumAttachment.create({
          target_type: 'post', target_id: 0,
          user_id: req.user.id, file_type: 'image',
          file_name: file.originalname, file_path: relativePath,
          file_size: file.size, mime_type: file.mimetype,
          storage_mode: 'local', sort_order: attachments.length
        });
        attachments.push(att);
      }
      ResponseHelper.success(res, attachments, '上传成功');
    } catch (error) {
      logger.error('上传图片失败:', error);
      ResponseHelper.error(res, '上传图片失败');
    }
  },

  async uploadFiles(req, res) {
    try {
      if (!req.files || req.files.length === 0) {
        return ResponseHelper.error(res, '没有上传文件', 400);
      }
      const attachments = [];
      for (const file of req.files) {
        const relativePath = path.relative(config.upload.uploadDir, file.path);
        const att = await ForumAttachment.create({
          target_type: 'post', target_id: 0,
          user_id: req.user.id, file_type: 'file',
          file_name: file.originalname, file_path: relativePath,
          file_size: file.size, mime_type: file.mimetype,
          storage_mode: 'local', sort_order: attachments.length
        });
        attachments.push(att);
      }
      ResponseHelper.success(res, attachments, '上传成功');
    } catch (error) {
      logger.error('上传文件失败:', error);
      ResponseHelper.error(res, '上传文件失败');
    }
  },

  /**
   * v2.1 新增：删除单个附件（数据库记录+磁盘文件）
   * 
   * 权限：只有上传者本人或超级管理员可以删除
   */
  async deleteAttachment(req, res) {
    try {
      const { id } = req.params;
      const att = await ForumAttachment.findById(id);
      if (!att) return ResponseHelper.notFound(res, '附件不存在');

      /* 权限检查：只有上传者或超管可删 */
      if (att.user_id !== req.user.id && req.user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '无权删除此附件');
      }

      /* 删除数据库记录 */
      await ForumAttachment.deleteById(id);

      /* 删除磁盘文件 */
      await cleanupAttachmentFiles([att]);

      logger.info('附件删除成功', { attachmentId: id, userId: req.user.id });
      ResponseHelper.success(res, null, '附件删除成功');
    } catch (error) {
      logger.error('删除附件失败:', error);
      ResponseHelper.error(res, '删除附件失败');
    }
  },

  /* ================================================================
   * 通知
   * ================================================================ */

  async getNotifications(req, res) {
    try {
      const { page, limit, type } = req.query;
      const result = await ForumNotificationService.getUserNotifications(req.user.id, { page, limit, type });
      ResponseHelper.success(res, result, '获取通知成功');
    } catch (error) {
      logger.error('获取通知失败:', error);
      ResponseHelper.error(res, '获取通知失败');
    }
  },

  async markAllNotificationsRead(req, res) {
    try {
      const count = await ForumNotificationService.markAllRead(req.user.id);
      ResponseHelper.success(res, { updated: count }, '已全部标记为已读');
    } catch (error) {
      logger.error('标记已读失败:', error);
      ResponseHelper.error(res, '操作失败');
    }
  },

  async getUnreadCount(req, res) {
    try {
      const count = await ForumNotificationService.getUnreadCount(req.user.id);
      ResponseHelper.success(res, { unread_count: count }, '获取成功');
    } catch (error) {
      ResponseHelper.success(res, { unread_count: 0 }, '获取成功');
    }
  },

  /* ================================================================
   * @提及用户搜索
   * ================================================================ */

  async searchUsers(req, res) {
    try {
      const { keyword } = req.query;
      if (!keyword || keyword.length < 1) {
        return ResponseHelper.success(res, [], '请输入搜索关键词');
      }
      const sql = 'SELECT id, username FROM users WHERE status = ? AND username LIKE ? LIMIT 10';
      const { rows } = await dbConnection.simpleQuery(sql, ['active', `%${keyword}%`]);
      ResponseHelper.success(res, rows, '搜索成功');
    } catch (error) {
      logger.error('搜索用户失败:', error);
      ResponseHelper.success(res, [], '搜索失败');
    }
  },

  /* ================================================================
   * 版主操作
   * ================================================================ */

  async modTogglePin(req, res) { return ForumController._modToggleStatus(req, res, 'is_pinned', '置顶'); },
  async modToggleFeature(req, res) { return ForumController._modToggleStatus(req, res, 'is_featured', '精华'); },
  async modToggleHide(req, res) { return ForumController._modToggleStatus(req, res, 'is_hidden', '隐藏'); },
  async modToggleLock(req, res) { return ForumController._modToggleStatus(req, res, 'is_locked', '锁定'); },
  async modToggleDisableReply(req, res) { return ForumController._modToggleStatus(req, res, 'is_reply_disabled', '禁止回复'); },

  async _modToggleStatus(req, res, field, label) {
    try {
      const { id } = req.params;
      const post = await ForumPost.findById(id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { isModerator } = await ForumModeratorService.checkModeratorPermission(req.user.id, post.board_id, req.user);
      if (!isModerator) return ResponseHelper.forbidden(res, '需要版主权限');

      const updated = await ForumPost.toggleStatus(id, field);
      const newState = updated[field] ? '已' : '取消';

      logger.info(`版主操作: ${newState}${label}`, { postId: id, operator: req.user.username });
      ResponseHelper.success(res, updated, `${newState}${label}`);
    } catch (error) {
      logger.error(`版主${label}操作失败:`, error);
      ResponseHelper.error(res, '操作失败');
    }
  },

  async modHideReply(req, res) {
    try {
      const { id } = req.params;
      const reply = await ForumReply.findById(id);
      if (!reply) return ResponseHelper.notFound(res, '回复不存在');

      const post = await ForumPost.findById(reply.post_id);
      if (!post) return ResponseHelper.notFound(res, '帖子不存在');

      const { isModerator } = await ForumModeratorService.checkModeratorPermission(req.user.id, post.board_id, req.user);
      if (!isModerator) return ResponseHelper.forbidden(res, '需要版主权限');

      const newHidden = !reply.is_hidden;
      await ForumReply.updateById(id, { is_hidden: newHidden });

      ResponseHelper.success(res, { is_hidden: newHidden }, newHidden ? '已隐藏' : '已取消隐藏');
    } catch (error) {
      logger.error('隐藏回复失败:', error);
      ResponseHelper.error(res, '操作失败');
    }
  },

  /* ================================================================
   * 管理端 - 版块管理
   * ================================================================ */

  async adminGetBoards(req, res) {
    try {
      const boards = await ForumBoard.findAll({}, { orderBy: 'sort_order ASC, id ASC' });
      ResponseHelper.success(res, boards, '获取版块列表成功');
    } catch (error) {
      logger.error('管理端获取版块失败:', error);
      ResponseHelper.error(res, '获取版块列表失败');
    }
  },

  async adminCreateBoard(req, res) {
    try {
      const { name, description, icon, color, cover_image, rules, visibility, allowed_group_ids, sort_order } = req.body;
      if (!name || !name.trim()) return ResponseHelper.error(res, '版块名称不能为空', 400);

      const board = await ForumBoard.create({
        name: name.trim(), description, icon, color, cover_image, rules,
        visibility: visibility || 'public',
        allowed_group_ids: allowed_group_ids || null,
        sort_order: sort_order || 0,
        created_by: req.user.id
      });
      ResponseHelper.success(res, board, '版块创建成功', 201);
    } catch (error) {
      logger.error('创建版块失败:', error);
      ResponseHelper.error(res, error.message || '创建版块失败');
    }
  },

  async adminUpdateBoard(req, res) {
    try {
      const { id } = req.params;
      const board = await ForumBoard.findById(id);
      if (!board) return ResponseHelper.notFound(res, '版块不存在');
      const updated = await ForumBoard.updateById(id, req.body);
      ResponseHelper.success(res, updated, '版块更新成功');
    } catch (error) {
      logger.error('更新版块失败:', error);
      ResponseHelper.error(res, error.message || '更新版块失败');
    }
  },

  async adminDeleteBoard(req, res) {
    try {
      const { id } = req.params;
      const board = await ForumBoard.findById(id);
      if (!board) return ResponseHelper.notFound(res, '版块不存在');
      if (board.post_count > 0) return ResponseHelper.error(res, '该版块下有帖子，不能删除', 400);
      await ForumBoard.deleteById(id);
      ResponseHelper.success(res, null, '版块删除成功');
    } catch (error) {
      logger.error('删除版块失败:', error);
      ResponseHelper.error(res, '删除版块失败');
    }
  },

  /* ================================================================
   * 管理端 - 版主管理
   * ================================================================ */

  async adminGetModerators(req, res) {
    try {
      const { boardId } = req.params;
      const moderators = await ForumModeratorService.getModeratorsByBoard(boardId);
      ResponseHelper.success(res, moderators, '获取版主列表成功');
    } catch (error) {
      logger.error('获取版主列表失败:', error);
      ResponseHelper.error(res, '获取版主列表失败');
    }
  },

  async adminAppointModerator(req, res) {
    try {
      const { boardId } = req.params;
      const { user_id } = req.body;
      if (!user_id) return ResponseHelper.error(res, '请指定用户ID', 400);
      await ForumModeratorService.appointModerator(boardId, user_id, req.user.id);
      ResponseHelper.success(res, null, '版主指定成功');
    } catch (error) {
      logger.error('指定版主失败:', error);
      ResponseHelper.error(res, error.message || '指定版主失败');
    }
  },

  async adminRemoveModerator(req, res) {
    try {
      const { id } = req.params;
      const success = await ForumModeratorService.removeModerator(id);
      if (!success) return ResponseHelper.notFound(res, '版主记录不存在');
      ResponseHelper.success(res, null, '版主移除成功');
    } catch (error) {
      logger.error('移除版主失败:', error);
      ResponseHelper.error(res, '移除版主失败');
    }
  },

  /* ================================================================
   * 管理端 - 统计
   * ================================================================ */

  async adminGetStats(req, res) {
    try {
      const [boardCount, postCount, replyCount, userCount] = await Promise.all([
        ForumBoard.count({}),
        ForumPost.count({}),
        ForumReply.count({}),
        dbConnection.query('SELECT COUNT(DISTINCT user_id) as cnt FROM forum_posts WHERE deleted_at IS NULL')
      ]);
      ResponseHelper.success(res, {
        board_count: boardCount,
        post_count: postCount,
        reply_count: replyCount,
        active_user_count: userCount.rows[0].cnt
      }, '获取统计成功');
    } catch (error) {
      logger.error('获取论坛统计失败:', error);
      ResponseHelper.error(res, '获取统计失败');
    }
  }
};

module.exports = ForumController;
