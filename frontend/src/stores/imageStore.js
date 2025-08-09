/**
 * 图像生成状态管理
 */

import { create } from 'zustand';
import api from '../utils/api';
import { message } from 'antd';

const useImageStore = create((set, get) => ({
  // 状态
  models: [],
  selectedModel: null,
  generating: false,
  generationHistory: [],
  historyPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  publicGallery: [],
  galleryPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  userStats: null,
  loading: false,

  // 获取可用模型列表
  getModels: async () => {
    try {
      set({ loading: true });
      const response = await api.get('/image/models');
      if (response.data.success) {
        set({ 
          models: response.data.data,
          selectedModel: response.data.data[0] || null
        });
      }
    } catch (error) {
      console.error('获取模型列表失败:', error);
      message.error('获取模型列表失败');
    } finally {
      set({ loading: false });
    }
  },

  // 选择模型
  selectModel: (model) => {
    set({ selectedModel: model });
  },

  // 生成图片
  generateImage: async (params) => {
    const { selectedModel } = get();
    if (!selectedModel) {
      message.error('请先选择模型');
      return null;
    }

    try {
      set({ generating: true });
      const response = await api.post('/image/generate', {
        model_id: selectedModel.id,
        ...params
      });

      if (response.data.success) {
        message.success('图片生成成功');
        // 刷新历史记录
        get().getUserHistory();
        return response.data.data;
      } else {
        message.error(response.data.message || '生成失败');
        return null;
      }
    } catch (error) {
      console.error('生成图片失败:', error);
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error('生成图片失败，请稍后重试');
      }
      return null;
    } finally {
      set({ generating: false });
    }
  },

  // 获取用户生成历史
  getUserHistory: async (params = {}) => {
    try {
      set({ loading: true });
      const response = await api.get('/image/history', { params });
      if (response.data.success) {
        set({
          generationHistory: response.data.data.data,
          historyPagination: response.data.data.pagination
        });
      }
    } catch (error) {
      console.error('获取历史记录失败:', error);
      message.error('获取历史记录失败');
    } finally {
      set({ loading: false });
    }
  },

  // 删除生成记录
  deleteGeneration: async (id) => {
    try {
      const response = await api.delete(`/image/generation/${id}`);
      if (response.data.success) {
        message.success('删除成功');
        // 刷新历史记录
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('删除失败:', error);
      message.error('删除失败');
      return false;
    }
  },

  // 批量删除
  batchDeleteGenerations: async (ids) => {
    try {
      const response = await api.post('/image/generations/batch-delete', { ids });
      if (response.data.success) {
        message.success(response.data.message);
        // 刷新历史记录
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('批量删除失败:', error);
      message.error('批量删除失败');
      return false;
    }
  },

  // 切换收藏状态
  toggleFavorite: async (id) => {
    try {
      const response = await api.post(`/image/generation/${id}/favorite`);
      if (response.data.success) {
        message.success('操作成功');
        // 刷新历史记录
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('切换收藏失败:', error);
      message.error('操作失败');
      return false;
    }
  },

  // 切换公开状态
  togglePublic: async (id) => {
    try {
      const response = await api.post(`/image/generation/${id}/public`);
      if (response.data.success) {
        message.success('操作成功');
        // 刷新历史记录
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('切换公开状态失败:', error);
      message.error('操作失败');
      return false;
    }
  },

  // 获取公开画廊
  getPublicGallery: async (params = {}) => {
    try {
      set({ loading: true });
      const response = await api.get('/image/gallery', { params });
      if (response.data.success) {
        set({
          publicGallery: response.data.data.data,
          galleryPagination: response.data.data.pagination
        });
      }
    } catch (error) {
      console.error('获取画廊失败:', error);
      message.error('获取画廊失败');
    } finally {
      set({ loading: false });
    }
  },

  // 获取用户统计
  getUserStats: async () => {
    try {
      const response = await api.get('/image/stats');
      if (response.data.success) {
        set({ userStats: response.data.data });
      }
    } catch (error) {
      console.error('获取统计信息失败:', error);
    }
  },

  // 重置状态
  reset: () => {
    set({
      models: [],
      selectedModel: null,
      generating: false,
      generationHistory: [],
      historyPagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      },
      publicGallery: [],
      galleryPagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      },
      userStats: null,
      loading: false
    });
  }
}));

export default useImageStore;
