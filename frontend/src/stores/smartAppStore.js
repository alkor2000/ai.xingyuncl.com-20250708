/**
 * 智能应用状态管理Store
 * 管理用户端应用广场的数据
 * 
 * 版本：v1.1.0
 * 更新：2025-12-30 修复数据结构匹配
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
  categories: [],           // 分类列表
  categoryStats: [],        // 分类统计
  loading: false,           // 加载状态
  currentApp: null,         // 当前选中的应用
  
  /**
   * 获取已发布的应用列表（用户端）
   * 后端直接返回数组格式
   */
  getPublishedApps: async () => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/smart-apps');
      if (response.data.success) {
        // 后端直接返回数组
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
   * 获取分类列表和统计
   */
  getCategories: async () => {
    try {
      const response = await apiClient.get('/smart-apps/categories');
      if (response.data.success) {
        const data = response.data.data || {};
        set({ 
          categories: data.categories || [],
          categoryStats: data.stats || []
        });
        return data;
      }
    } catch (error) {
      console.error('获取分类列表失败:', error);
      return { categories: [], stats: [] };
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
   * 获取应用配置（包含系统提示词，用于创建会话）
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
        // 更新本地使用次数
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
      // 不阻断流程，静默失败
    }
  },
  
  /**
   * 按分类获取应用
   */
  getAppsByCategory: (category) => {
    const { apps } = get();
    if (!category || category === '全部') {
      return apps;
    }
    return apps.filter(app => app.category === category);
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
      loading: false,
      currentApp: null
    });
  }
}));

export default useSmartAppStore;
