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
  generationProgress: null, // 新增：生成进度
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

  // 批量生成图片（新方法）
  generateImages: async (params) => {
    const { selectedModel } = get();
    if (!selectedModel) {
      message.error('请先选择模型');
      return null;
    }

    try {
      set({ generating: true, generationProgress: null });
      
      // 显示生成进度
      const quantity = params.quantity || 1;
      if (quantity > 1) {
        set({ generationProgress: `0/${quantity}` });
        message.loading(`正在生成 ${quantity} 张图片，请稍候...`, 0);
      }

      const response = await api.post('/image/generate', {
        model_id: selectedModel.id,
        ...params
      });

      if (response.data.success) {
        const result = response.data.data;
        
        // 关闭loading提示
        message.destroy();
        
        if (quantity > 1) {
          // 批量生成结果
          if (result.succeeded === result.requested) {
            message.success(`成功生成 ${result.succeeded} 张图片，消耗 ${result.creditsConsumed} 积分`);
          } else if (result.succeeded > 0) {
            message.warning(`部分成功：生成了 ${result.succeeded}/${result.requested} 张图片，消耗 ${result.creditsConsumed} 积分`);
          } else {
            message.error('所有图片生成失败');
          }
        } else {
          // 单张生成
          message.success('图片生成成功');
        }
        
        // 刷新历史记录
        get().getUserHistory();
        return result;
      } else {
        message.destroy();
        message.error(response.data.message || '生成失败');
        return null;
      }
    } catch (error) {
      message.destroy();
      console.error('生成图片失败:', error);
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error('生成图片失败，请稍后重试');
      }
      return null;
    } finally {
      set({ generating: false, generationProgress: null });
    }
  },

  // 生成单张图片（保持兼容性）
  generateImage: async (params) => {
    return get().generateImages({ ...params, quantity: 1 });
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
      generationProgress: null,
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
