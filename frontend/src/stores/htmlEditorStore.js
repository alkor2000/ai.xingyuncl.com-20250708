/**
 * HTML编辑器状态管理
 */

import { create } from 'zustand';
import apiClient from '../utils/api';
import { message } from 'antd';

const useHtmlEditorStore = create((set, get) => ({
  // 状态
  projects: [],
  pages: [],
  currentPage: null,
  templates: [],
  resources: [],
  loading: false,
  error: null,

  // 获取项目列表
  getProjects: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get('/html-editor/projects');
      if (response.data.success) {
        set({ projects: response.data.data });
      }
    } catch (error) {
      console.error('获取项目列表失败:', error);
      set({ error: error.message });
      message.error('获取项目列表失败');
    } finally {
      set({ loading: false });
    }
  },

  // 创建项目
  createProject: async (projectData) => {
    try {
      const response = await apiClient.post('/html-editor/projects', projectData);
      if (response.data.success) {
        // 刷新项目列表
        await get().getProjects();
        return response.data.data;
      }
    } catch (error) {
      console.error('创建项目失败:', error);
      throw error;
    }
  },

  // 更新项目
  updateProject: async (projectId, updateData) => {
    try {
      const response = await apiClient.put(`/html-editor/projects/${projectId}`, updateData);
      if (response.data.success) {
        await get().getProjects();
        return response.data.data;
      }
    } catch (error) {
      console.error('更新项目失败:', error);
      throw error;
    }
  },

  // 删除项目
  deleteProject: async (projectId) => {
    try {
      const response = await apiClient.delete(`/html-editor/projects/${projectId}`);
      if (response.data.success) {
        await get().getProjects();
        return true;
      }
    } catch (error) {
      console.error('删除项目失败:', error);
      throw error;
    }
  },

  // 获取页面列表
  getPages: async (projectId = null) => {
    set({ loading: true });
    try {
      const params = projectId ? { project_id: projectId } : {};
      const response = await apiClient.get('/html-editor/pages', { params });
      if (response.data.success) {
        set({ pages: response.data.data });
      }
    } catch (error) {
      console.error('获取页面列表失败:', error);
      message.error('获取页面列表失败');
    } finally {
      set({ loading: false });
    }
  },

  // 创建页面
  createPage: async (pageData) => {
    try {
      const response = await apiClient.post('/html-editor/pages', pageData);
      if (response.data.success) {
        // 更新当前页面
        set({ currentPage: response.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('创建页面失败:', error);
      throw error;
    }
  },

  // 加载页面
  loadPage: async (pageId) => {
    set({ loading: true });
    try {
      const response = await apiClient.get(`/html-editor/pages/${pageId}`);
      if (response.data.success) {
        set({ currentPage: response.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('加载页面失败:', error);
      message.error('加载页面失败');
    } finally {
      set({ loading: false });
    }
  },

  // 更新页面
  updatePage: async (pageId, updateData) => {
    try {
      const response = await apiClient.put(`/html-editor/pages/${pageId}`, updateData);
      if (response.data.success) {
        // 更新当前页面
        if (get().currentPage?.id === pageId) {
          set({ currentPage: response.data.data });
        }
        return response.data.data;
      }
    } catch (error) {
      console.error('更新页面失败:', error);
      throw error;
    }
  },

  // 删除页面
  deletePage: async (pageId) => {
    try {
      const response = await apiClient.delete(`/html-editor/pages/${pageId}`);
      if (response.data.success) {
        // 如果删除的是当前页面，清空当前页面
        if (get().currentPage?.id === pageId) {
          set({ currentPage: null });
        }
        return true;
      }
    } catch (error) {
      console.error('删除页面失败:', error);
      throw error;
    }
  },

  // 发布/取消发布页面
  togglePublish: async (pageId) => {
    try {
      const response = await apiClient.post(`/html-editor/pages/${pageId}/toggle-publish`);
      if (response.data.success) {
        // 更新页面列表中的状态
        set(state => ({
          pages: state.pages.map(page => 
            page.id === pageId ? response.data.data : page
          )
        }));
        
        // 如果是当前页面，也更新当前页面
        if (get().currentPage?.id === pageId) {
          set({ currentPage: response.data.data });
        }
        
        return response.data.data;
      }
    } catch (error) {
      console.error('切换发布状态失败:', error);
      throw error;
    }
  },

  // 获取模板列表
  getTemplates: async (category = null) => {
    try {
      const params = category ? { category } : {};
      const response = await apiClient.get('/html-editor/templates', { params });
      if (response.data.success) {
        set({ templates: response.data.data });
      }
    } catch (error) {
      console.error('获取模板列表失败:', error);
    }
  },

  // 清空状态
  reset: () => {
    set({
      projects: [],
      pages: [],
      currentPage: null,
      templates: [],
      resources: [],
      loading: false,
      error: null
    });
  }
}));

export default useHtmlEditorStore;
