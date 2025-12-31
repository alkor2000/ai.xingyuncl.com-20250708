/**
 * 智能应用状态管理Store
 * 管理用户端应用广场的数据
 * 
 * 版本：v2.2.0
 * 更新：
 * - 2025-12-30 v2.0.0 支持动态分类和多分类筛选
 * - 2025-12-30 v2.2.0 新增用户收藏功能
 */

import { create } from 'zustand';
import { message } from 'antd';
import apiClient from '../utils/api';

/**
 * 智能应用Store
 */
const useSmartAppStore = create((set, get) => ({
  // 状态
  apps: [],                 // 已发布的应用列表
  categories: [],           // 分类列表（从数据库加载）
  categoryStats: [],        // 分类统计（每个分类的应用数量）
  favoriteCount: 0,         // v2.2.0 收藏数量
  loading: false,           // 加载状态
  currentApp: null,         // 当前选中的应用
  
  /**
   * 获取已发布的应用列表（用户端）
   * v2.2.0 返回含收藏状态
   */
  getPublishedApps: async (categoryId = null) => {
    set({ loading: true });
    try {
      const params = {};
      if (categoryId) {
        params.category_id = categoryId;
      }
      
      const response = await apiClient.get('/smart-apps', { params });
      if (response.data.success) {
        const apps = response.data.data || [];
        set({ 
          apps: apps,
          loading: false 
        });
        return apps;
      }
      set({ loading: false });
      return [];
    } catch (error) {
      console.error('获取智能应用列表失败:', error);
      set({ loading: false });
      return [];
    }
  },
  
  /**
   * 获取分类列表和统计（从数据库动态加载）
   * v2.2.0 返回收藏数量
   */
  getCategories: async () => {
    try {
      const response = await apiClient.get('/smart-apps/categories');
      if (response.data.success) {
        const data = response.data.data || {};
        set({ 
          categories: data.categories || [],
          categoryStats: data.stats || [],
          favoriteCount: data.favoriteCount || 0  // v2.2.0
        });
        return data;
      }
    } catch (error) {
      console.error('获取分类列表失败:', error);
      return { categories: [], stats: [], favoriteCount: 0 };
    }
  },
  
  /**
   * v2.2.0 获取我的收藏列表
   */
  getFavorites: async () => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/smart-apps/favorites');
      if (response.data.success) {
        const apps = response.data.data || [];
        set({ loading: false });
        return apps;
      }
      set({ loading: false });
      return [];
    } catch (error) {
      console.error('获取收藏列表失败:', error);
      set({ loading: false });
      return [];
    }
  },
  
  /**
   * v2.2.0 切换收藏状态
   */
  toggleFavorite: async (appId) => {
    const { apps } = get();
    const app = apps.find(a => a.id === appId);
    const isFavorited = app?.is_favorited;
    
    try {
      let response;
      if (isFavorited) {
        // 取消收藏
        response = await apiClient.delete(`/smart-apps/${appId}/favorite`);
      } else {
        // 添加收藏
        response = await apiClient.post(`/smart-apps/${appId}/favorite`);
      }
      
      if (response.data.success) {
        // 更新本地状态
        set(state => ({
          apps: state.apps.map(a => 
            a.id === appId 
              ? { ...a, is_favorited: !isFavorited }
              : a
          ),
          favoriteCount: isFavorited 
            ? state.favoriteCount - 1 
            : state.favoriteCount + 1
        }));
        
        message.success(isFavorited ? '已取消收藏' : '收藏成功');
        return !isFavorited;
      }
    } catch (error) {
      console.error('切换收藏状态失败:', error);
      message.error('操作失败');
      return isFavorited;
    }
  },
  
  /**
   * 获取单个应用详情
   */
  getAppDetail: async (appId) => {
    try {
      const response = await apiClient.get(`/smart-apps/${appId}`);
      if (response.data.success) {
        set({ currentApp: response.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('获取应用详情失败:', error);
      throw error;
    }
  },
  
  /**
   * 获取应用配置
   */
  getAppConfig: async (appId) => {
    try {
      const response = await apiClient.get(`/smart-apps/${appId}/config`);
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error('获取配置失败');
    } catch (error) {
      console.error('获取应用配置失败:', error);
      throw error;
    }
  },
  
  /**
   * 使用应用（记录使用次数）
   */
  useApp: async (appId) => {
    try {
      const response = await apiClient.post(`/smart-apps/${appId}/use`);
      if (response.data.success) {
        set(state => ({
          apps: state.apps.map(app => 
            app.id === appId 
              ? { ...app, use_count: (app.use_count || 0) + 1 }
              : app
          )
        }));
        return response.data.data;
      }
    } catch (error) {
      console.error('记录应用使用失败:', error);
    }
  },
  
  /**
   * 获取或创建智能应用会话
   */
  getOrCreateConversation: async (appId) => {
    try {
      const response = await apiClient.get(`/smart-apps/${appId}/conversation`);
      if (response.data.success) {
        const data = response.data.data;
        
        if (data.isNew) {
          set(state => ({
            apps: state.apps.map(app => 
              app.id === appId 
                ? { ...app, use_count: (app.use_count || 0) + 1 }
                : app
            )
          }));
        }
        
        return data;
      }
      throw new Error('获取会话失败');
    } catch (error) {
      console.error('获取智能应用会话失败:', error);
      throw error;
    }
  },
  
  /**
   * 清空智能应用会话
   */
  clearConversation: async (appId) => {
    try {
      const response = await apiClient.post(`/smart-apps/${appId}/conversation/clear`);
      if (response.data.success) {
        message.success('对话已清空');
        return response.data.data;
      }
      throw new Error('清空会话失败');
    } catch (error) {
      console.error('清空智能应用会话失败:', error);
      throw error;
    }
  },
  
  /**
   * 按分类获取应用（本地过滤）
   */
  getAppsByCategory: (categoryId) => {
    const { apps } = get();
    if (!categoryId || categoryId === 'all') {
      return apps;
    }
    const catId = parseInt(categoryId);
    return apps.filter(app => 
      app.category_ids && app.category_ids.includes(catId)
    );
  },
  
  /**
   * 搜索应用
   */
  searchApps: (keyword) => {
    const { apps } = get();
    if (!keyword) {
      return apps;
    }
    const lowerKeyword = keyword.toLowerCase();
    return apps.filter(app => 
      app.name.toLowerCase().includes(lowerKeyword) ||
      (app.description && app.description.toLowerCase().includes(lowerKeyword))
    );
  },
  
  /**
   * 清空当前应用
   */
  clearCurrentApp: () => {
    set({ currentApp: null });
  },
  
  /**
   * 重置Store
   */
  reset: () => {
    set({
      apps: [],
      categories: [],
      categoryStats: [],
      favoriteCount: 0,
      loading: false,
      currentApp: null
    });
  }
}));

export default useSmartAppStore;
