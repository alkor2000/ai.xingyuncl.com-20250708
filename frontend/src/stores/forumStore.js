/**
 * 论坛模块状态管理 Store v2.2
 * 
 * v2.2 - fetchBoardPosts解析后端返回的meta.is_board_moderator
 * v2.1 - deleteAttachment 删除单个附件
 * 
 * @module stores/forumStore
 */

import { create } from 'zustand';
import { message } from 'antd';
import apiClient from '../utils/api';

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
      console.error('获取版块失败:', error);
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
      console.error('获取帖子列表失败:', error);
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
      console.error('获取热帖失败:', error);
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
      console.error('获取帖子详情失败:', error);
      set({ currentPostLoading: false });
      if (error.response?.status === 404) message.error('帖子不存在或已被删除');
      return null;
    }
  },

  clearCurrentPost: () => set({ currentPost: null, replies: [], repliesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),

  createPost: async (data) => {
    try {
      const res = await apiClient.post('/forum/posts', data);
      if (res.data.success) { message.success('发帖成功'); return res.data.data; }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || error.message || '发帖失败');
      throw error;
    }
  },

  updatePost: async (postId, data) => {
    try {
      const res = await apiClient.put(`/forum/posts/${postId}`, data);
      if (res.data.success) {
        message.success('编辑成功');
        set(state => ({ currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, ...res.data.data } : state.currentPost }));
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '编辑失败');
      throw error;
    }
  },

  deletePost: async (postId) => {
    try {
      const res = await apiClient.delete(`/forum/posts/${postId}`);
      if (res.data.success) {
        message.success('删除成功');
        set(state => ({ posts: state.posts.filter(p => p.id !== parseInt(postId)), myPosts: state.myPosts.filter(p => p.id !== parseInt(postId)) }));
        return true;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '删除失败');
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
      console.error('获取回复列表失败:', error);
      set({ repliesLoading: false });
    }
  },

  createReply: async (postId, data) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/replies`, data);
      if (res.data.success) {
        message.success('回复成功');
        set(state => ({
          replies: [...state.replies, res.data.data],
          currentPost: state.currentPost ? { ...state.currentPost, reply_count: (state.currentPost.reply_count || 0) + 1 } : null
        }));
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || error.message || '回复失败');
      throw error;
    }
  },

  updateReply: async (replyId, content) => {
    try {
      const res = await apiClient.put(`/forum/replies/${replyId}`, { content });
      if (res.data.success) {
        message.success('编辑成功');
        set(state => ({ replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, ...res.data.data } : r) }));
        return res.data.data;
      }
    } catch (error) { message.error('编辑失败'); throw error; }
  },

  deleteReply: async (replyId) => {
    try {
      const res = await apiClient.delete(`/forum/replies/${replyId}`);
      if (res.data.success) {
        message.success('删除成功');
        set(state => ({
          replies: state.replies.filter(r => r.id !== parseInt(replyId)),
          currentPost: state.currentPost ? { ...state.currentPost, reply_count: Math.max((state.currentPost.reply_count || 0) - 1, 0) } : null
        }));
        return true;
      }
    } catch (error) { message.error('删除失败'); throw error; }
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
    } catch (error) { message.error('操作失败'); }
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
    } catch (error) { message.error('操作失败'); }
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
        message.success(favorited ? '已收藏' : '已取消收藏');
        return favorited;
      }
    } catch (error) { message.error('操作失败'); }
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
    } catch (error) { message.error(error.response?.data?.message || '图片上传失败'); throw error; }
  },

  uploadFiles: async (files) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      const res = await apiClient.post('/forum/upload/files', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      if (res.data.success) return res.data.data;
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || '文件上传失败'); throw error; }
  },

  deleteAttachment: async (attachmentId) => {
    try {
      const res = await apiClient.delete(`/forum/attachments/${attachmentId}`);
      if (res.data.success) {
        message.success('附件已删除');
        return true;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '删除附件失败');
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
    } catch (error) { console.error('标记已读失败:', error); }
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
    } catch (error) { message.error(error.response?.data?.message || '操作失败'); throw error; }
  },

  modHideReply: async (replyId) => {
    try {
      const res = await apiClient.put(`/forum/mod/replies/${replyId}/hide`);
      if (res.data.success) {
        message.success(res.data.message);
        set(state => ({ replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, is_hidden: res.data.data.is_hidden } : r) }));
        return res.data.data;
      }
    } catch (error) { message.error('操作失败'); throw error; }
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
      if (res.data.success) { message.success('版块创建成功'); get().adminFetchBoards(); return res.data.data; }
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || '创建失败'); throw error; }
  },

  adminUpdateBoard: async (boardId, data) => {
    try {
      const res = await apiClient.put(`/forum/admin/boards/${boardId}`, data);
      if (res.data.success) { message.success('版块更新成功'); get().adminFetchBoards(); return res.data.data; }
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || '更新失败'); throw error; }
  },

  adminDeleteBoard: async (boardId) => {
    try {
      const res = await apiClient.delete(`/forum/admin/boards/${boardId}`);
      if (res.data.success) { message.success('版块删除成功'); get().adminFetchBoards(); return true; }
      throw new Error(res.data.message);
    } catch (error) { message.error(error.response?.data?.message || '删除失败'); throw error; }
  },

  adminFetchModerators: async (boardId) => {
    try {
      const res = await apiClient.get(`/forum/admin/boards/${boardId}/moderators`);
      if (res.data.success) { set({ moderators: res.data.data || [] }); return res.data.data; }
    } catch (error) { console.error('获取版主列表失败:', error); }
  },

  adminAppointModerator: async (boardId, userId) => {
    try {
      const res = await apiClient.post(`/forum/admin/boards/${boardId}/moderators`, { user_id: userId });
      if (res.data.success) { message.success('版主指定成功'); get().adminFetchModerators(boardId); return true; }
    } catch (error) { message.error('指定版主失败'); throw error; }
  },

  adminRemoveModerator: async (moderatorId, boardId) => {
    try {
      const res = await apiClient.delete(`/forum/admin/moderators/${moderatorId}`);
      if (res.data.success) { message.success('版主移除成功'); get().adminFetchModerators(boardId); return true; }
    } catch (error) { message.error('移除版主失败'); throw error; }
  },

  adminFetchStats: async () => {
    try {
      const res = await apiClient.get('/forum/admin/stats');
      if (res.data.success) { set({ forumStats: res.data.data }); return res.data.data; }
    } catch (error) { console.error('获取论坛统计失败:', error); }
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
