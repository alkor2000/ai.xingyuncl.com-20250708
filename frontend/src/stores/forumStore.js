/**
 * 论坛模块状态管理 Store
 * 
 * 管理版块、帖子、回复、通知等论坛数据
 * 采用 Zustand 状态管理，API 调用集中在 Store 层
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

  /* 版块 */
  boards: [],
  boardsLoading: false,
  currentBoard: null,

  /* 帖子列表 */
  posts: [],
  postsLoading: false,
  postsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  postsSort: 'active',

  /* 帖子详情 */
  currentPost: null,
  currentPostLoading: false,

  /* 回复 */
  replies: [],
  repliesLoading: false,
  repliesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

  /* 热帖 */
  hotPosts: [],
  hotPostsLoading: false,

  /* 我的帖子 */
  myPosts: [],
  myPostsLoading: false,
  myPostsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

  /* 收藏 */
  favorites: [],
  favoritesLoading: false,
  favoritesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

  /* 通知 */
  notifications: [],
  notificationsLoading: false,
  unreadCount: 0,

  /* 管理端 */
  adminBoards: [],
  adminBoardsLoading: false,
  moderators: [],

  /* 论坛统计 */
  forumStats: null,

  /* ================================================================
   * 版块
   * ================================================================ */

  /** 获取用户可见版块列表 */
  fetchBoards: async () => {
    set({ boardsLoading: true });
    try {
      const res = await apiClient.get('/forum/boards');
      if (res.data.success) {
        set({ boards: res.data.data || [], boardsLoading: false });
      } else {
        set({ boardsLoading: false });
      }
    } catch (error) {
      console.error('获取版块失败:', error);
      set({ boardsLoading: false });
    }
  },

  /* ================================================================
   * 帖子列表
   * ================================================================ */

  /** 获取版块帖子列表 */
  fetchBoardPosts: async (boardId, options = {}) => {
    set({ postsLoading: true });
    try {
      const { page = 1, limit = 20, sort } = options;
      const currentSort = sort || get().postsSort;
      const res = await apiClient.get(`/forum/boards/${boardId}/posts`, {
        params: { page, limit, sort: currentSort }
      });
      if (res.data.success) {
        set({
          posts: res.data.data || [],
          postsPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 },
          postsSort: currentSort,
          postsLoading: false
        });
      } else {
        set({ postsLoading: false });
      }
    } catch (error) {
      console.error('获取帖子列表失败:', error);
      set({ postsLoading: false });
    }
  },

  /** 设置排序模式 */
  setPostsSort: (sort) => set({ postsSort: sort }),

  /** 获取热帖 */
  fetchHotPosts: async (limit = 10) => {
    set({ hotPostsLoading: true });
    try {
      const res = await apiClient.get('/forum/posts/hot', { params: { limit } });
      if (res.data.success) {
        set({ hotPosts: res.data.data || [], hotPostsLoading: false });
      } else {
        set({ hotPostsLoading: false });
      }
    } catch (error) {
      console.error('获取热帖失败:', error);
      set({ hotPostsLoading: false });
    }
  },

  /* ================================================================
   * 帖子详情
   * ================================================================ */

  /** 获取帖子详情 */
  fetchPostDetail: async (postId) => {
    set({ currentPostLoading: true });
    try {
      const res = await apiClient.get(`/forum/posts/${postId}`);
      if (res.data.success) {
        set({ currentPost: res.data.data, currentPostLoading: false });
        return res.data.data;
      }
      set({ currentPostLoading: false });
      return null;
    } catch (error) {
      console.error('获取帖子详情失败:', error);
      set({ currentPostLoading: false });
      if (error.response?.status === 404) {
        message.error('帖子不存在或已被删除');
      }
      return null;
    }
  },

  /** 清除当前帖子 */
  clearCurrentPost: () => set({ currentPost: null, replies: [], repliesPagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),

  /** 发帖 */
  createPost: async (data) => {
    try {
      const res = await apiClient.post('/forum/posts', data);
      if (res.data.success) {
        message.success('发帖成功');
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      console.error('发帖失败:', error);
      message.error(error.response?.data?.message || error.message || '发帖失败');
      throw error;
    }
  },

  /** 编辑帖子 */
  updatePost: async (postId, data) => {
    try {
      const res = await apiClient.put(`/forum/posts/${postId}`, data);
      if (res.data.success) {
        message.success('编辑成功');
        /* 更新本地状态 */
        set(state => ({
          currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, ...res.data.data } : state.currentPost
        }));
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      console.error('编辑帖子失败:', error);
      message.error(error.response?.data?.message || '编辑失败');
      throw error;
    }
  },

  /** 删除帖子 */
  deletePost: async (postId) => {
    try {
      const res = await apiClient.delete(`/forum/posts/${postId}`);
      if (res.data.success) {
        message.success('删除成功');
        /* 从列表中移除 */
        set(state => ({
          posts: state.posts.filter(p => p.id !== parseInt(postId)),
          myPosts: state.myPosts.filter(p => p.id !== parseInt(postId))
        }));
        return true;
      }
      throw new Error(res.data.message);
    } catch (error) {
      console.error('删除帖子失败:', error);
      message.error(error.response?.data?.message || '删除失败');
      throw error;
    }
  },

  /* ================================================================
   * 回复
   * ================================================================ */

  /** 获取帖子回复列表 */
  fetchReplies: async (postId, options = {}) => {
    set({ repliesLoading: true });
    try {
      const { page = 1, limit = 20 } = options;
      const res = await apiClient.get(`/forum/posts/${postId}/replies`, {
        params: { page, limit }
      });
      if (res.data.success) {
        set({
          replies: res.data.data || [],
          repliesPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 },
          repliesLoading: false
        });
      } else {
        set({ repliesLoading: false });
      }
    } catch (error) {
      console.error('获取回复列表失败:', error);
      set({ repliesLoading: false });
    }
  },

  /** 发布回复 */
  createReply: async (postId, data) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/replies`, data);
      if (res.data.success) {
        message.success('回复成功');
        /* 追加到本地列表 */
        set(state => ({
          replies: [...state.replies, res.data.data],
          currentPost: state.currentPost ? {
            ...state.currentPost,
            reply_count: (state.currentPost.reply_count || 0) + 1
          } : null
        }));
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      console.error('回复失败:', error);
      message.error(error.response?.data?.message || error.message || '回复失败');
      throw error;
    }
  },

  /** 编辑回复 */
  updateReply: async (replyId, content) => {
    try {
      const res = await apiClient.put(`/forum/replies/${replyId}`, { content });
      if (res.data.success) {
        message.success('编辑成功');
        set(state => ({
          replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, ...res.data.data } : r)
        }));
        return res.data.data;
      }
    } catch (error) {
      message.error('编辑失败');
      throw error;
    }
  },

  /** 删除回复 */
  deleteReply: async (replyId) => {
    try {
      const res = await apiClient.delete(`/forum/replies/${replyId}`);
      if (res.data.success) {
        message.success('删除成功');
        set(state => ({
          replies: state.replies.filter(r => r.id !== parseInt(replyId)),
          currentPost: state.currentPost ? {
            ...state.currentPost,
            reply_count: Math.max((state.currentPost.reply_count || 0) - 1, 0)
          } : null
        }));
        return true;
      }
    } catch (error) {
      message.error('删除失败');
      throw error;
    }
  },

  /* ================================================================
   * 点赞 / 收藏
   * ================================================================ */

  /** 切换帖子点赞 */
  togglePostLike: async (postId) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/like`);
      if (res.data.success) {
        const { liked } = res.data.data;
        /* 更新帖子列表和详情中的状态 */
        set(state => ({
          posts: state.posts.map(p => p.id === parseInt(postId) ? {
            ...p, is_liked: liked ? 1 : 0, like_count: liked ? (p.like_count || 0) + 1 : Math.max((p.like_count || 0) - 1, 0)
          } : p),
          currentPost: state.currentPost?.id === parseInt(postId) ? {
            ...state.currentPost, is_liked: liked ? 1 : 0, like_count: liked ? (state.currentPost.like_count || 0) + 1 : Math.max((state.currentPost.like_count || 0) - 1, 0)
          } : state.currentPost
        }));
        return liked;
      }
    } catch (error) {
      message.error('操作失败');
    }
  },

  /** 切换回复点赞 */
  toggleReplyLike: async (replyId) => {
    try {
      const res = await apiClient.post(`/forum/replies/${replyId}/like`);
      if (res.data.success) {
        const { liked } = res.data.data;
        set(state => ({
          replies: state.replies.map(r => r.id === parseInt(replyId) ? {
            ...r, is_liked: liked ? 1 : 0, like_count: liked ? (r.like_count || 0) + 1 : Math.max((r.like_count || 0) - 1, 0)
          } : r)
        }));
        return liked;
      }
    } catch (error) {
      message.error('操作失败');
    }
  },

  /** 切换帖子收藏 */
  toggleFavorite: async (postId) => {
    try {
      const res = await apiClient.post(`/forum/posts/${postId}/favorite`);
      if (res.data.success) {
        const { favorited } = res.data.data;
        set(state => ({
          posts: state.posts.map(p => p.id === parseInt(postId) ? {
            ...p, is_favorited: favorited ? 1 : 0, favorite_count: favorited ? (p.favorite_count || 0) + 1 : Math.max((p.favorite_count || 0) - 1, 0)
          } : p),
          currentPost: state.currentPost?.id === parseInt(postId) ? {
            ...state.currentPost, is_favorited: favorited ? 1 : 0, favorite_count: favorited ? (state.currentPost.favorite_count || 0) + 1 : Math.max((state.currentPost.favorite_count || 0) - 1, 0)
          } : state.currentPost
        }));
        message.success(favorited ? '已收藏' : '已取消收藏');
        return favorited;
      }
    } catch (error) {
      message.error('操作失败');
    }
  },

  /** 获取我的收藏 */
  fetchFavorites: async (options = {}) => {
    set({ favoritesLoading: true });
    try {
      const { page = 1, limit = 20 } = options;
      const res = await apiClient.get('/forum/favorites', { params: { page, limit } });
      if (res.data.success) {
        set({
          favorites: res.data.data || [],
          favoritesPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 },
          favoritesLoading: false
        });
      } else {
        set({ favoritesLoading: false });
      }
    } catch (error) {
      console.error('获取收藏失败:', error);
      set({ favoritesLoading: false });
    }
  },

  /** 获取我的帖子 */
  fetchMyPosts: async (options = {}) => {
    set({ myPostsLoading: true });
    try {
      const { page = 1, limit = 20 } = options;
      const res = await apiClient.get('/forum/my-posts', { params: { page, limit } });
      if (res.data.success) {
        set({
          myPosts: res.data.data || [],
          myPostsPagination: res.data.pagination || { page, limit, total: 0, totalPages: 0 },
          myPostsLoading: false
        });
      } else {
        set({ myPostsLoading: false });
      }
    } catch (error) {
      console.error('获取我的帖子失败:', error);
      set({ myPostsLoading: false });
    }
  },

  /* ================================================================
   * 附件上传
   * ================================================================ */

  /** 上传图片 */
  uploadImages: async (files) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('images', file));
      const res = await apiClient.post('/forum/upload/images', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000
      });
      if (res.data.success) return res.data.data;
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '图片上传失败');
      throw error;
    }
  },

  /** 上传文件 */
  uploadFiles: async (files) => {
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      const res = await apiClient.post('/forum/upload/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000
      });
      if (res.data.success) return res.data.data;
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '文件上传失败');
      throw error;
    }
  },

  /* ================================================================
   * 通知
   * ================================================================ */

  /** 获取通知列表 */
  fetchNotifications: async (options = {}) => {
    set({ notificationsLoading: true });
    try {
      const { page = 1, limit = 20, type } = options;
      const res = await apiClient.get('/forum/notifications', { params: { page, limit, type } });
      if (res.data.success) {
        const data = res.data.data || {};
        set({
          notifications: data.items || [],
          unreadCount: data.unreadCount || 0,
          notificationsLoading: false
        });
      } else {
        set({ notificationsLoading: false });
      }
    } catch (error) {
      console.error('获取通知失败:', error);
      set({ notificationsLoading: false });
    }
  },

  /** 标记全部已读 */
  markAllNotificationsRead: async () => {
    try {
      const res = await apiClient.put('/forum/notifications/read-all');
      if (res.data.success) {
        set(state => ({
          notifications: state.notifications.map(n => ({ ...n, is_read: 1 })),
          unreadCount: 0
        }));
      }
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  },

  /** 获取未读通知数 */
  fetchUnreadCount: async () => {
    try {
      const res = await apiClient.get('/forum/notifications/unread-count');
      if (res.data.success) {
        set({ unreadCount: res.data.data?.unread_count || 0 });
      }
    } catch (error) {
      /* 静默失败 */
    }
  },

  /* ================================================================
   * @提及用户搜索
   * ================================================================ */

  /** 搜索用户（@提及联想） */
  searchUsers: async (keyword) => {
    try {
      if (!keyword || keyword.length < 1) return [];
      const res = await apiClient.get('/forum/users/search', { params: { keyword } });
      return res.data.success ? (res.data.data || []) : [];
    } catch (error) {
      return [];
    }
  },

  /* ================================================================
   * 版主操作
   * ================================================================ */

  /** 版主切换帖子状态 */
  modTogglePostStatus: async (postId, action) => {
    try {
      const res = await apiClient.put(`/forum/mod/posts/${postId}/${action}`);
      if (res.data.success) {
        message.success(res.data.message);
        /* 更新本地帖子状态 */
        set(state => ({
          currentPost: state.currentPost?.id === parseInt(postId) ? { ...state.currentPost, ...res.data.data } : state.currentPost,
          posts: state.posts.map(p => p.id === parseInt(postId) ? { ...p, ...res.data.data } : p)
        }));
        return res.data.data;
      }
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败');
      throw error;
    }
  },

  /** 版主隐藏回复 */
  modHideReply: async (replyId) => {
    try {
      const res = await apiClient.put(`/forum/mod/replies/${replyId}/hide`);
      if (res.data.success) {
        message.success(res.data.message);
        set(state => ({
          replies: state.replies.map(r => r.id === parseInt(replyId) ? { ...r, is_hidden: res.data.data.is_hidden } : r)
        }));
        return res.data.data;
      }
    } catch (error) {
      message.error('操作失败');
      throw error;
    }
  },

  /* ================================================================
   * 管理端
   * ================================================================ */

  /** 管理端-获取所有版块 */
  adminFetchBoards: async () => {
    set({ adminBoardsLoading: true });
    try {
      const res = await apiClient.get('/forum/admin/boards');
      if (res.data.success) {
        set({ adminBoards: res.data.data || [], adminBoardsLoading: false });
      } else {
        set({ adminBoardsLoading: false });
      }
    } catch (error) {
      console.error('管理端获取版块失败:', error);
      set({ adminBoardsLoading: false });
    }
  },

  /** 管理端-创建版块 */
  adminCreateBoard: async (data) => {
    try {
      const res = await apiClient.post('/forum/admin/boards', data);
      if (res.data.success) {
        message.success('版块创建成功');
        get().adminFetchBoards();
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '创建失败');
      throw error;
    }
  },

  /** 管理端-更新版块 */
  adminUpdateBoard: async (boardId, data) => {
    try {
      const res = await apiClient.put(`/forum/admin/boards/${boardId}`, data);
      if (res.data.success) {
        message.success('版块更新成功');
        get().adminFetchBoards();
        return res.data.data;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '更新失败');
      throw error;
    }
  },

  /** 管理端-删除版块 */
  adminDeleteBoard: async (boardId) => {
    try {
      const res = await apiClient.delete(`/forum/admin/boards/${boardId}`);
      if (res.data.success) {
        message.success('版块删除成功');
        get().adminFetchBoards();
        return true;
      }
      throw new Error(res.data.message);
    } catch (error) {
      message.error(error.response?.data?.message || '删除失败');
      throw error;
    }
  },

  /** 管理端-获取版主列表 */
  adminFetchModerators: async (boardId) => {
    try {
      const res = await apiClient.get(`/forum/admin/boards/${boardId}/moderators`);
      if (res.data.success) {
        set({ moderators: res.data.data || [] });
        return res.data.data;
      }
    } catch (error) {
      console.error('获取版主列表失败:', error);
    }
  },

  /** 管理端-指定版主 */
  adminAppointModerator: async (boardId, userId) => {
    try {
      const res = await apiClient.post(`/forum/admin/boards/${boardId}/moderators`, { user_id: userId });
      if (res.data.success) {
        message.success('版主指定成功');
        get().adminFetchModerators(boardId);
        return true;
      }
    } catch (error) {
      message.error('指定版主失败');
      throw error;
    }
  },

  /** 管理端-移除版主 */
  adminRemoveModerator: async (moderatorId, boardId) => {
    try {
      const res = await apiClient.delete(`/forum/admin/moderators/${moderatorId}`);
      if (res.data.success) {
        message.success('版主移除成功');
        get().adminFetchModerators(boardId);
        return true;
      }
    } catch (error) {
      message.error('移除版主失败');
      throw error;
    }
  },

  /** 管理端-获取论坛统计 */
  adminFetchStats: async () => {
    try {
      const res = await apiClient.get('/forum/admin/stats');
      if (res.data.success) {
        set({ forumStats: res.data.data });
        return res.data.data;
      }
    } catch (error) {
      console.error('获取论坛统计失败:', error);
    }
  },

  /* ================================================================
   * 重置
   * ================================================================ */
  reset: () => {
    set({
      boards: [], currentBoard: null,
      posts: [], postsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      currentPost: null, replies: [],
      hotPosts: [], myPosts: [], favorites: [],
      notifications: [], unreadCount: 0,
      adminBoards: [], moderators: [], forumStats: null
    });
  }
}));

export default useForumStore;
