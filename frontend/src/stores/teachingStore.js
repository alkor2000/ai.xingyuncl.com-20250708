/**
 * 智能教学系统 Store
 * 使用 Zustand 管理教学模块、课程、权限状态
 * 修复：正确处理API响应格式 { success: true, data: {...} }
 */

import { create } from 'zustand';
import api from '../utils/api';
import { message } from 'antd';

const useTeachingStore = create((set, get) => ({
  // ==================== 状态 ====================
  
  // 模块列表
  modules: [],
  modulesPagination: {
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  },
  modulesLoading: false,
  
  // 当前模块
  currentModule: null,
  currentModuleLoading: false,
  
  // 课程列表
  lessons: [],
  lessonsLoading: false,
  
  // 当前课程
  currentLesson: null,
  currentLessonLoading: false,
  
  // 权限列表
  permissions: [],
  permissionsLoading: false,
  
  // 草稿
  draft: null,
  draftSaving: false,
  
  // ==================== 模块操作 ====================
  
  /**
   * 获取模块列表
   */
  fetchModules: async (params = {}) => {
    set({ modulesLoading: true });
    try {
      const response = await api.get('/teaching/modules', { params });
      // 修复：正确访问响应数据 response.data.data
      const responseData = response.data.data || response.data;
      set({
        modules: responseData.modules || [],
        modulesPagination: responseData.pagination || {},
        modulesLoading: false
      });
      return responseData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取模块列表失败');
      set({ modulesLoading: false });
      throw error;
    }
  },
  
  /**
   * 获取单个模块详情
   */
  fetchModule: async (id) => {
    set({ currentModuleLoading: true });
    try {
      const response = await api.get(`/teaching/modules/${id}`);
      // 修复：正确访问响应数据
      const moduleData = response.data.data || response.data;
      set({
        currentModule: moduleData,
        currentModuleLoading: false
      });
      return moduleData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取模块详情失败');
      set({ currentModuleLoading: false });
      throw error;
    }
  },
  
  /**
   * 创建模块
   */
  createModule: async (data) => {
    try {
      const response = await api.post('/teaching/modules', data);
      message.success('模块创建成功');
      // 重新加载列表
      await get().fetchModules();
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '创建模块失败');
      throw error;
    }
  },
  
  /**
   * 更新模块
   */
  updateModule: async (id, data) => {
    try {
      const response = await api.put(`/teaching/modules/${id}`, data);
      message.success('模块更新成功');
      const moduleData = response.data.data || response.data;
      // 更新当前模块
      if (get().currentModule?.id === id) {
        set({ currentModule: moduleData });
      }
      // 重新加载列表
      await get().fetchModules();
      return moduleData;
    } catch (error) {
      message.error(error.response?.data?.message || '更新模块失败');
      throw error;
    }
  },
  
  /**
   * 删除模块
   */
  deleteModule: async (id) => {
    try {
      await api.delete(`/teaching/modules/${id}`);
      message.success('模块删除成功');
      // 重新加载列表
      await get().fetchModules();
    } catch (error) {
      message.error(error.response?.data?.message || '删除模块失败');
      throw error;
    }
  },
  
  // ==================== 课程操作 ====================
  
  /**
   * 获取模块的课程列表
   */
  fetchLessons: async (moduleId, params = {}) => {
    set({ lessonsLoading: true });
    try {
      const response = await api.get(`/teaching/modules/${moduleId}/lessons`, { params });
      // 修复：正确访问响应数据
      const lessonsData = response.data.data || response.data;
      set({
        lessons: Array.isArray(lessonsData) ? lessonsData : [],
        lessonsLoading: false
      });
      return lessonsData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取课程列表失败');
      set({ lessonsLoading: false });
      throw error;
    }
  },
  
  /**
   * 获取单个课程详情
   */
  fetchLesson: async (id) => {
    set({ currentLessonLoading: true });
    try {
      const response = await api.get(`/teaching/lessons/${id}`);
      // 修复：正确访问响应数据
      const lessonData = response.data.data || response.data;
      set({
        currentLesson: lessonData,
        currentLessonLoading: false
      });
      return lessonData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取课程详情失败');
      set({ currentLessonLoading: false });
      throw error;
    }
  },
  
  /**
   * 创建课程
   */
  createLesson: async (data) => {
    try {
      const response = await api.post('/teaching/lessons', data);
      message.success('课程创建成功');
      // 重新加载课程列表
      if (data.module_id) {
        await get().fetchLessons(data.module_id);
      }
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '创建课程失败');
      throw error;
    }
  },
  
  /**
   * 更新课程
   */
  updateLesson: async (id, data) => {
    try {
      const response = await api.put(`/teaching/lessons/${id}`, data);
      message.success('课程更新成功');
      const lessonData = response.data.data || response.data;
      // 更新当前课程
      if (get().currentLesson?.id === id) {
        set({ currentLesson: lessonData });
      }
      return lessonData;
    } catch (error) {
      message.error(error.response?.data?.message || '更新课程失败');
      throw error;
    }
  },
  
  /**
   * 删除课程
   */
  deleteLesson: async (id, moduleId) => {
    try {
      await api.delete(`/teaching/lessons/${id}`);
      message.success('课程删除成功');
      // 重新加载课程列表
      if (moduleId) {
        await get().fetchLessons(moduleId);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '删除课程失败');
      throw error;
    }
  },
  
  // ==================== 权限操作 ====================
  
  /**
   * 获取模块权限列表
   */
  fetchPermissions: async (moduleId) => {
    set({ permissionsLoading: true });
    try {
      const response = await api.get(`/teaching/modules/${moduleId}/permissions`);
      // 修复：正确访问响应数据
      const permissionsData = response.data.data || response.data;
      set({
        permissions: Array.isArray(permissionsData) ? permissionsData : [],
        permissionsLoading: false
      });
      return permissionsData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取权限列表失败');
      set({ permissionsLoading: false });
      throw error;
    }
  },
  
  /**
   * 授予权限
   */
  grantPermission: async (data) => {
    try {
      const response = await api.post('/teaching/permissions', data);
      message.success('权限授予成功');
      // 重新加载权限列表
      if (data.module_id) {
        await get().fetchPermissions(data.module_id);
      }
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '授予权限失败');
      throw error;
    }
  },
  
  /**
   * 撤销权限
   */
  revokePermission: async (permissionId, moduleId) => {
    try {
      await api.delete(`/teaching/permissions/${permissionId}`);
      message.success('权限撤销成功');
      // 重新加载权限列表
      if (moduleId) {
        await get().fetchPermissions(moduleId);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '撤销权限失败');
      throw error;
    }
  },
  
  /**
   * 批量撤销权限
   */
  revokeMultiplePermissions: async (permissionIds, moduleId) => {
    try {
      await api.post('/teaching/permissions/revoke-multiple', {
        permission_ids: permissionIds
      });
      message.success(`成功撤销${permissionIds.length}个权限`);
      // 重新加载权限列表
      if (moduleId) {
        await get().fetchPermissions(moduleId);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '批量撤销权限失败');
      throw error;
    }
  },
  
  // ==================== 草稿操作 ====================
  
  /**
   * 自动保存草稿
   */
  saveDraft: async (data) => {
    set({ draftSaving: true });
    try {
      const response = await api.post('/teaching/drafts/autosave', data);
      const draftData = response.data.data || response.data;
      set({
        draft: draftData,
        draftSaving: false
      });
      return draftData;
    } catch (error) {
      console.error('自动保存草稿失败:', error);
      set({ draftSaving: false });
      throw error;
    }
  },
  
  /**
   * 获取草稿
   */
  fetchDraft: async (lessonId) => {
    try {
      const response = await api.get(`/teaching/drafts/${lessonId || 'null'}`);
      const draftData = response.data.data || response.data;
      set({ draft: draftData });
      return draftData;
    } catch (error) {
      console.error('获取草稿失败:', error);
      throw error;
    }
  },
  
  // ==================== 浏览记录 ====================
  
  /**
   * 记录浏览行为
   */
  recordView: async (data) => {
    try {
      await api.post('/teaching/view-logs', data);
    } catch (error) {
      console.error('记录浏览行为失败:', error);
    }
  },
  
  // ==================== 重置状态 ====================
  
  resetCurrentModule: () => set({ currentModule: null }),
  resetCurrentLesson: () => set({ currentLesson: null }),
  resetLessons: () => set({ lessons: [] }),
  resetPermissions: () => set({ permissions: [] }),
  resetDraft: () => set({ draft: null })
}));

export default useTeachingStore;
