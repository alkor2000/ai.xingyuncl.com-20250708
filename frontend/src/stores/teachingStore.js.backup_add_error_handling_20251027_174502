/**
 * 智能教学系统 Store（分组增强版）
 * 新增：教学模块分组管理功能
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
  
  // 分组列表（新增）
  groups: [],
  groupsLoading: false,
  
  // 分组模块数据（新增）
  groupedModules: [],
  groupedModulesLoading: false,
  
  // 管理员全局模块列表
  allModules: [],
  allModulesLoading: false,
  
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
  
  // ==================== 分组操作（新增）====================
  
  /**
   * 获取所有分组列表
   */
  fetchGroups: async (params = {}) => {
    set({ groupsLoading: true });
    try {
      const response = await api.get('/teaching/groups', { params });
      const groupsData = response.data.data || response.data;
      set({
        groups: Array.isArray(groupsData) ? groupsData : [],
        groupsLoading: false
      });
      return groupsData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取分组列表失败');
      set({ groupsLoading: false });
      throw error;
    }
  },
  
  /**
   * 获取按分组返回的模块数据
   */
  fetchGroupedModules: async (params = {}) => {
    set({ groupedModulesLoading: true });
    try {
      const response = await api.get('/teaching/modules', { 
        params: {
          ...params,
          group_by: 'group'
        }
      });
      const responseData = response.data.data || response.data;
      set({
        groupedModules: responseData.groups || [],
        modulesPagination: responseData.pagination || {},
        groupedModulesLoading: false
      });
      return responseData;
    } catch (error) {
      message.error(error.response?.data?.message || '获取分组模块失败');
      set({ groupedModulesLoading: false });
      throw error;
    }
  },
  
  /**
   * 创建分组（仅超级管理员）
   */
  createGroup: async (data) => {
    try {
      const response = await api.post('/teaching/groups', data);
      message.success('分组创建成功');
      await get().fetchGroups();
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '创建分组失败');
      throw error;
    }
  },
  
  /**
   * 更新分组（仅超级管理员）
   */
  updateGroup: async (id, data) => {
    try {
      const response = await api.put(`/teaching/groups/${id}`, data);
      message.success('分组更新成功');
      await get().fetchGroups();
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '更新分组失败');
      throw error;
    }
  },
  
  /**
   * 删除分组（仅超级管理员）
   */
  deleteGroup: async (id) => {
    try {
      await api.delete(`/teaching/groups/${id}`);
      message.success('分组删除成功');
      await get().fetchGroups();
      await get().fetchGroupedModules();
    } catch (error) {
      message.error(error.response?.data?.message || '删除分组失败');
      throw error;
    }
  },
  
  /**
   * 获取分组的模块列表
   */
  fetchGroupModules: async (groupId) => {
    try {
      const response = await api.get(`/teaching/groups/${groupId}/modules`);
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '获取分组模块失败');
      throw error;
    }
  },
  
  // ==================== 模块操作 ====================
  
  /**
   * 获取模块列表（用户视角，受权限限制）
   */
  fetchModules: async (params = {}) => {
    set({ modulesLoading: true });
    try {
      const response = await api.get('/teaching/modules', { params });
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
   * 获取所有模块（管理员视角，不受权限限制）
   */
  fetchAllModules: async (params = {}) => {
    set({ allModulesLoading: true });
    try {
      const response = await api.get('/teaching/admin/modules', { 
        params: {
          ...params,
          all: true
        }
      });
      const responseData = response.data.data || response.data;
      const modulesArray = responseData.modules || responseData;
      
      set({
        allModules: Array.isArray(modulesArray) ? modulesArray : [],
        allModulesLoading: false
      });
      return modulesArray;
    } catch (error) {
      message.error(error.response?.data?.message || '获取全部模块失败');
      set({ allModulesLoading: false });
      throw error;
    }
  },
  
  /**
   * 获取单个模块详情（增强：包含分组信息）
   */
  fetchModule: async (id) => {
    set({ currentModuleLoading: true });
    try {
      const response = await api.get(`/teaching/modules/${id}`);
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
   * 创建模块（增强：支持分组）
   */
  createModule: async (data) => {
    try {
      const response = await api.post('/teaching/modules', data);
      message.success('模块创建成功');
      await get().fetchGroupedModules();
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '创建模块失败');
      throw error;
    }
  },
  
  /**
   * 更新模块（增强：支持更新分组）
   */
  updateModule: async (id, data) => {
    try {
      const response = await api.put(`/teaching/modules/${id}`, data);
      message.success('模块更新成功');
      const moduleData = response.data.data || response.data;
      if (get().currentModule?.id === id) {
        set({ currentModule: moduleData });
      }
      await get().fetchGroupedModules();
      return moduleData;
    } catch (error) {
      message.error(error.response?.data?.message || '更新模块失败');
      throw error;
    }
  },
  
  /**
   * 批量更新模块（管理员功能）
   */
  batchUpdateModules: async (moduleIds, updateData) => {
    try {
      const response = await api.post('/teaching/admin/modules/batch-update', {
        module_ids: moduleIds,
        update_data: updateData
      });
      message.success(`成功更新${moduleIds.length}个模块`);
      await get().fetchAllModules();
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '批量更新模块失败');
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
      await get().fetchGroupedModules();
    } catch (error) {
      message.error(error.response?.data?.message || '删除模块失败');
      throw error;
    }
  },
  
  // ==================== 课程操作 ====================
  
  fetchLessons: async (moduleId, params = {}) => {
    set({ lessonsLoading: true });
    try {
      const response = await api.get(`/teaching/modules/${moduleId}/lessons`, { params });
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
  
  fetchLesson: async (id) => {
    set({ currentLessonLoading: true });
    try {
      const response = await api.get(`/teaching/lessons/${id}`);
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
  
  createLesson: async (data) => {
    try {
      const response = await api.post('/teaching/lessons', data);
      message.success('课程创建成功');
      if (data.module_id) {
        await get().fetchLessons(data.module_id);
      }
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '创建课程失败');
      throw error;
    }
  },
  
  updateLesson: async (id, data) => {
    try {
      const response = await api.put(`/teaching/lessons/${id}`, data);
      message.success('课程更新成功');
      const lessonData = response.data.data || response.data;
      if (get().currentLesson?.id === id) {
        set({ currentLesson: lessonData });
      }
      return lessonData;
    } catch (error) {
      message.error(error.response?.data?.message || '更新课程失败');
      throw error;
    }
  },
  
  deleteLesson: async (id, moduleId) => {
    try {
      await api.delete(`/teaching/lessons/${id}`);
      message.success('课程删除成功');
      if (moduleId) {
        await get().fetchLessons(moduleId);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '删除课程失败');
      throw error;
    }
  },
  
  // ==================== 权限操作 ====================
  
  fetchPermissions: async (moduleId) => {
    set({ permissionsLoading: true });
    try {
      const response = await api.get(`/teaching/modules/${moduleId}/permissions`);
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
  
  grantPermission: async (data) => {
    try {
      const response = await api.post('/teaching/permissions', data);
      message.success('权限授予成功');
      if (data.module_id) {
        await get().fetchPermissions(data.module_id);
      }
      return response.data.data || response.data;
    } catch (error) {
      message.error(error.response?.data?.message || '授予权限失败');
      throw error;
    }
  },
  
  revokePermission: async (permissionId, moduleId) => {
    try {
      await api.delete(`/teaching/permissions/${permissionId}`);
      message.success('权限撤销成功');
      if (moduleId) {
        await get().fetchPermissions(moduleId);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '撤销权限失败');
      throw error;
    }
  },
  
  revokeMultiplePermissions: async (permissionIds, moduleId) => {
    try {
      await api.post('/teaching/permissions/revoke-multiple', {
        permission_ids: permissionIds
      });
      message.success(`成功撤销${permissionIds.length}个权限`);
      if (moduleId) {
        await get().fetchPermissions(moduleId);
      }
    } catch (error) {
      message.error(error.response?.data?.message || '批量撤销权限失败');
      throw error;
    }
  },
  
  // ==================== 草稿操作 ====================
  
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
  resetDraft: () => set({ draft: null }),
  resetAllModules: () => set({ allModules: [] }),
  resetGroups: () => set({ groups: [] }),
  resetGroupedModules: () => set({ groupedModules: [] })
}));

export default useTeachingStore;
