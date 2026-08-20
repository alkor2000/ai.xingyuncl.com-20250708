/**
 * 论坛模块状态管理 Store v2.3
 * 
 * v2.2 - fetchBoardPosts解析后端返回的meta.is_board_moderator
 * v2.1 - deleteAttachment 删除单个附件
 * v2.3 - i18n国际化适配：
 *   非React模块无法用useTranslation，改用i18next实例i18n.t()直接调用
 *   post/reply的create/update/delete结果提示新增forum.json的post.* 和 reply.* 两组键
 *   favorite的toggle结果提示新增favorite.favoritedResult/unfavoritedResult
 *   （与已有的favorited按钮态标签语义不同：一个是状态标签一个是操作结果toast）
 *   点赞/收藏toggle失败复用common.json的message.error（通用操作失败）
 *   图片/文件上传失败兜底复用forum.upload.failed（后端已返回message时不会触发）
 *   版主操作失败新增moderator.actionFailed（与点赞收藏的通用操作失败语境不同）
 *   管理端版块/版主CRUD新增admin.*Success/Failed共10个键
 *   纯开发者日志（console.error）统一改英文，不进语言包
 * 
 * @module stores/forumStore
 */

import { create } from 'zustand';
import { message } from 'antd';
import apiClient from '../utils/api';
import i18n from '../utils/i18n';

const useForumStore = create((set, get) => ({

  /* ================================================================
   * 状态
   * ================================================================ */
  boards: [],
  boardsLoading: false,
  currentBoard: null,
  posts: [],
  postsLoading: false,
  postsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  postsSort: 'active',
  /* v2.2: 当前版块的版主身份 */
  isBoardModerator: false,
  currentPost: null,
  currentPostLoading: false,
  replies: [],
  repliesLoading: false,
  repliesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  hotPosts: [],
  hotPostsLoading: false,
  myPosts: [],
  myPostsLoading: false,
  myPostsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  favorites: [],
  favoritesLoading: false,
  favoritesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  notifications: [],
  notificationsLoading: false,
  unreadCount: 0,
  adminBoards: [],
  adminBoardsLoading: false,
  moderators: [],
  forumStats: null,

  /* ================================================================
   * 版块
   * ================================================================ */
  fetchBoards: async () => {
    set({ boardsLoading: true });
    try {
      const res = await apiClient.get('/forum/boards');
      if (res.data.success) set({ boards: res.data.data || [], boardsLoading: false });
      else set({ boardsLoading: false });
    } catch (error) {
      console.error('Failed to fetch boards:', error);
      set({ boardsLoading: false });
    }
  },

  /* ================================================================
   * 帖子列表
   * ================================================================ */

  /**
   * 获取版块帖子列表
   * v2.2: 后端getBoardPosts返回自定义格式含meta.is_board_moderator
   *       这里直接解析原始响应，同时兼容标准paginated格式
   */
  fetchBoardPosts: async (boardId, options = {}) => {
    set({ postsLoading: true });
    try {
      const { page = 1, limit = 20, sort } = options;
      const currentSort = sort || get().postsSort;
      const res = await apiClient.get(`/forum/boards/${boardId}/posts`, { params: { page, limit, sort: currentSort } });
      
      const resData = res.data;
      
      /* v2.2: 解析版主身份（后端自定义格式，meta在顶层） */
      const isBoardMod = resData.meta?.is_board_moderator === true;
      
      /* 兼容两种响应格式 */
      const posts = resData.data || [];
      const pagination = resData.pagination || { page, limit, total: 0, totalPages: 0 };
      
      set({
        posts,
        postsPagination: pagination,
        postsSort: currentSort,
        isBoardModerator: isBoardMod,
        postsLoading: false
      });
    } catch (error) {
      console.error('Failed to fetch board posts:', error);
      set({ postsLoading: false });
    }
  },

  setPostsSort: (sort) => set({ postsSort: sort }),

  fetchHotPosts: async (limit = 10) => {
    set({ hotPostsLoading: true });
    try {
      const res = await apiClient.get('/forum/posts/hot', { params: { limit } });
      if (res.data.success) set({ hotPosts: res.data.data || [], hotPostsLoading: false });
      else set({ hotPostsLoading: false });
    } catch (error) {
      console.error('Failed to fetch hot posts:', error);
      set({ hotPostsLoading: false });
    }
  },

  /* ================================================================
   * 帖子详情
   * ================================================================ */
  fetchPostDetail: async (postId) => {
    set({ currentPostLoading: true });
    try {
      const res = await apiClient.get(`/forum/posts/${postId}`);
      if (res.data.success) { set({ currentPost: res.data.data, currentPostLoading: false }); return res.data.data; }
      set({ currentPostLoading: false });
      return null;
    } catch (error) {
      console.error('Failed to fetch post detail:', error);
      set({ currentPostLoading: false });
      if (error.response?.status === 404) message.error(i18n.t('forum.post.notFound'));
      return null;
    }
  },

  clearCurrentPost: () => set({ currentPost: null, replies: [], repliesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),

  createPost: async (data) => {
    try {
      const res = await apiClient.post('/forum/posts', data);
      if (res.data.success) { message.success(i18n.t('forum.post.createSuccess')); return res.data.data; }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || error.message || i18n.t('forum.post.createFailed'));
      throw error;
    }
  },

  updatePost: async (postId, data) => {
    try {
      const res = await apiClient.put(`/forum/posts/${postId}`, data);
      if (res.data.success) {
        message.success(i18n.t('forum.post.updateSuccess'));
        set(state => ({ currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, ...res.data.data } : state.currentPost }));
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('forum.post.updateFailed'));
      throw error;
    }
  },

  deletePost: async (postId) => {
    try {
      const res = await apiClient.delete(`/forum/posts/${postId}`);
      if (res.data.success) {
        message.success(i18n.t('forum.post.deleteSuccess'));
        set(state => ({ posts: state.posts.filter(p => p.id !== parseInt(postId)), myPosts: state.myPosts.filter(p => p.id !== parseInt(postId)) }));
        return true;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('forum.post.deleteFailed'));
      throw error;
    }
  },

  /* ================================================================
   * 回复
   * ================================================================ */
  fetchReplies: async (postId, options = {}) => {
    set({ repliesLoading: true });
    try {
      const { page = 1, limit = 20 } = options;
      const res = await apiClient.get(`/forum/posts/${postId}/replies`, { params: { page, limit } });
      if (res.data.success) {
        set({ replies: res.data.data || [], repliesPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 }, repliesLoading: false });
      } else set({ repliesLoading: false });
    } catch (error) {
      console.error('Failed to fetch replies:', error);
      set({ repliesLoading: false });
    }
  },

  createReply: async (postId, data) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/replies`, data);
      if (res.data.success) {
        message.success(i18n.t('forum.reply.createSuccess'));
        set(state => ({
          replies: [...state.replies, res.data.data],
          currentPost: state.currentPost ? { ...state.currentPost, reply_count: (state.currentPost.reply_count || 0) + 1 } : null
        }));
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || error.message || i18n.t('forum.reply.createFailed'));
      throw error;
    }
  },

  updateReply: async (replyId, content) => {
    try {
      const res = await apiClient.put(`/forum/replies/${replyId}`, { content });
      if (res.data.success) {
        message.success(i18n.t('forum.reply.updateSuccess'));
        set(state => ({ replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, ...res.data.data } : r) }));
        return res.data.data;
      }
    } catch (error) { message.error(i18n.t('forum.reply.updateFailed')); throw error; }
  },

  deleteReply: async (replyId) => {
    try {
      const res = await apiClient.delete(`/forum/replies/${replyId}`);
      if (res.data.success) {
        message.success(i18n.t('forum.reply.deleteSuccess'));
        set(state => ({
          replies: state.replies.filter(r => r.id !== parseInt(replyId)),
          currentPost: state.currentPost ? { ...state.currentPost, reply_count: Math.max((state.currentPost.reply_count || 0) - 1, 0) } : null
        }));
        return true;
      }
    } catch (error) { message.error(i18n.t('forum.reply.deleteFailed')); throw error; }
  },

  /* ================================================================
   * 点赞 / 收藏
   * ================================================================ */
  togglePostLike: async (postId) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/like`);
      if (res.data.success) {
        const { liked } = res.data.data;
        set(state => ({
          posts: state.posts.map(p => p.id === parseInt(postId) ? { ...p, is_liked: liked ? 1 : 0, like_count: liked ? (p.like_count || 0) + 1 : Math.max((p.like_count || 0) - 1, 0) } : p),
          currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, is_liked: liked ? 1 : 0, like_count: liked ? (state.currentPost.like_count || 0) + 1 : Math.max((state.currentPost.like_count || 0) - 1, 0) } : state.currentPost
        }));
        return liked;
      }
    } catch (error) { message.error(i18n.t('message.error')); }
  },

  toggleReplyLike: async (replyId) => {
    try {
      const res = await apiClient.post(`/forum/replies/${replyId}/like`);
      if (res.data.success) {
        const { liked } = res.data.data;
        set(state => ({
          replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, is_liked: liked ? 1 : 0, like_count: liked ? (r.like_count || 0) + 1 : Math.max((r.like_count || 0) - 1, 0) } : r)
        }));
        return liked;
      }
    } catch (error) { message.error(i18n.t('message.error')); }
  },

  toggleFavorite: async (postId) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/favorite`);
      if (res.data.success) {
        const { favorited } = res.data.data;
        set(state => ({
          posts: state.posts.map(p => p.id === parseInt(postId) ? { ...p, is_favorited: favorited ? 1 : 0, favorite_count: favorited ? (p.favorite_count || 0) + 1 : Math.max((p.favorite_count || 0) - 1, 0) } : p),
          currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, is_favorited: favorited ? 1 : 0, favorite_count: favorited ? (state.currentPost.favorite_count || 0) + 1 : Math.max((state.currentPost.favorite_count || 0) - 1, 0) } : state.currentPost
        }));
        message.success(favorited ? i18n.t('forum.favorite.favoritedResult') : i18n.t('forum.favorite.unfavoritedResult'));
        return favorited;
      }
    } catch (error) { message.error(i18n.t('message.error')); }
  },

  fetchFavorites: async (options = {}) => {
    set({ favoritesLoading: true });
    try {
      const { page = 1, limit = 20 } = options;
      const res = await apiClient.get('/forum/favorites', { params: { page, limit } });
      if (res.data.success) set({ favorites: res.data.data || [], favoritesPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 }, favoritesLoading: false });
      else set({ favoritesLoading: false });
    } catch (error) { set({ favoritesLoading: false }); }
  },

  fetchMyPosts: async (options = {}) => {
    set({ myPostsLoading: true });
    try {
      const { page = 1, limit = 20 } = options;
      const res = await apiClient.get('/forum/my-posts', { params: { page, limit } });
      if (res.data.success) set({ myPosts: res.data.data || [], myPostsPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 }, myPostsLoading: false });
      else set({ myPostsLoading: false });
    } catch (error) { set({ myPostsLoading: false }); }
  },

  /* ================================================================
   * 附件上传 + 删除
   * ================================================================ */
  uploadImages: async (files) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('images', file));
      const res = await apiClient.post('/forum/upload/images', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
      if (res.data.success) return res.data.data;
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || i18n.t('forum.upload.failed')); throw error; }
  },

  uploadFiles: async (files) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      const res = await apiClient.post('/forum/upload/files', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      if (res.data.success) return res.data.data;
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || i18n.t('forum.upload.failed')); throw error; }
  },

  deleteAttachment: async (attachmentId) => {
    try {
      const res = await apiClient.delete(`/forum/attachments/${attachmentId}`);
      if (res.data.success) {
        message.success(i18n.t('forum.attachment.deleteSuccess'));
        return true;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('forum.attachment.deleteFailed'));
      throw error;
    }
  },

  /* ================================================================
   * 通知
   * ================================================================ */
  fetchNotifications: async (options = {}) => {
    set({ notificationsLoading: true });
    try {
      const { page = 1, limit = 20, type } = options;
      const res = await apiClient.get('/forum/notifications', { params: { page, limit, type } });
      if (res.data.success) {
        const data = res.data.data || {};
        set({ notifications: data.items || [], unreadCount: data.unreadCount || 0, notificationsLoading: false });
      } else set({ notificationsLoading: false });
    } catch (error) { set({ notificationsLoading: false }); }
  },

  markAllNotificationsRead: async () => {
    try {
      const res = await apiClient.put('/forum/notifications/read-all');
      if (res.data.success) set(state => ({ notifications: state.notifications.map(n => ({ ...n, is_read: 1 })), unreadCount: 0 }));
    } catch (error) { console.error('Failed to mark all as read:', error); }
  },

  fetchUnreadCount: async () => {
    try {
      const res = await apiClient.get('/forum/notifications/unread-count');
      if (res.data.success) set({ unreadCount: res.data.data?.unread_count || 0 });
    } catch (error) { /* 静默 */ }
  },

  /* ================================================================
   * @提及用户搜索
   * ================================================================ */
  searchUsers: async (keyword) => {
    try {
      if (!keyword || keyword.length < 1) return [];
      const res = await apiClient.get('/forum/users/search', { params: { keyword } });
      return res.data.success ? (res.data.data || []) : [];
    } catch (error) { return []; }
  },

  /* ================================================================
   * 版主操作
   * ================================================================ */
  modTogglePostStatus: async (postId, action) => {
    try {
      const res = await apiClient.put(`/forum/mod/posts/${postId}/${action}`);
      if (res.data.success) {
        message.success(res.data.message);
        set(state => ({
          currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, ...res.data.data } : state.currentPost,
          posts: state.posts.map(p => p.id === parseInt(postId) ? { ...p, ...res.data.data } : p)
        }));
        return res.data.data;
      }
    } catch (error) { message.error(error.response?.data?.message || i18n.t('forum.moderator.actionFailed')); throw error; }
  },

  modHideReply: async (replyId) => {
    try {
      const res = await apiClient.put(`/forum/mod/replies/${replyId}/hide`);
      if (res.data.success) {
        message.success(res.data.message);
        set(state => ({ replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, is_hidden: res.data.data.is_hidden } : r) }));
        return res.data.data;
      }
    } catch (error) { message.error(i18n.t('forum.moderator.actionFailed')); throw error; }
  },

  /* ================================================================
   * 管理端
   * ================================================================ */
  adminFetchBoards: async () => {
    set({ adminBoardsLoading: true });
    try {
      const res = await apiClient.get('/forum/admin/boards');
      if (res.data.success) set({ adminBoards: res.data.data || [], adminBoardsLoading: false });
      else set({ adminBoardsLoading: false });
    } catch (error) { set({ adminBoardsLoading: false }); }
  },

  adminCreateBoard: async (data) => {
    try {
      const res = await apiClient.post('/forum/admin/boards', data);
      if (res.data.success) { message.success(i18n.t('forum.admin.createBoardSuccess')); get().adminFetchBoards(); return res.data.data; }
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || i18n.t('forum.admin.createBoardFailed')); throw error; }
  },

  adminUpdateBoard: async (boardId, data) => {
    try {
      const res = await apiClient.put(`/forum/admin/boards/${boardId}`, data);
      if (res.data.success) { message.success(i18n.t('forum.admin.updateBoardSuccess')); get().adminFetchBoards(); return res.data.data; }
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || i18n.t('forum.admin.updateBoardFailed')); throw error; }
  },

  adminDeleteBoard: async (boardId) => {
    try {
      const res = await apiClient.delete(`/forum/admin/boards/${boardId}`);
      if (res.data.success) { message.success(i18n.t('forum.admin.deleteBoardSuccess')); get().adminFetchBoards(); return true; }
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || i18n.t('forum.admin.deleteBoardFailed')); throw error; }
  },

  adminFetchModerators: async (boardId) => {
    try {
      const res = await apiClient.get(`/forum/admin/boards/${boardId}/moderators`);
      if (res.data.success) { set({ moderators: res.data.data || [] }); return res.data.data; }
    } catch (error) { console.error('Failed to fetch moderator list:', error); }
  },

  adminAppointModerator: async (boardId, userId) => {
    try {
      const res = await apiClient.post(`/forum/admin/boards/${boardId}/moderators`, { user_id: userId });
      if (res.data.success) { message.success(i18n.t('forum.admin.appointModeratorSuccess')); get().adminFetchModerators(boardId); return true; }
    } catch (error) { message.error(i18n.t('forum.admin.appointModeratorFailed')); throw error; }
  },

  adminRemoveModerator: async (moderatorId, boardId) => {
    try {
      const res = await apiClient.delete(`/forum/admin/moderators/${moderatorId}`);
      if (res.data.success) { message.success(i18n.t('forum.admin.removeModeratorSuccess')); get().adminFetchModerators(boardId); return true; }
    } catch (error) { message.error(i18n.t('forum.admin.removeModeratorFailed')); throw error; }
  },

  adminFetchStats: async () => {
    try {
      const res = await apiClient.get('/forum/admin/stats');
      if (res.data.success) { set({ forumStats: res.data.data }); return res.data.data; }
    } catch (error) { console.error('Failed to fetch forum stats:', error); }
  },

  /* ================================================================
   * 重置
   * ================================================================ */
  reset: () => {
    set({
      boards: [], currentBoard: null,
      posts: [], postsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      isBoardModerator: false,
      currentPost: null, replies: [],
      hotPosts: [], myPosts: [], favorites: [],
      notifications: [], unreadCount: 0,
      adminBoards: [], moderators: [], forumStats: null
    });
  }
}));

export default useForumStore;
