/**
 * 智能教学系统 Store（错误处理增强版 + 教案功能）
 * 修复：添加403错误的友好处理，避免跳转到详情页后报错
 * 新增：教案保存和获取功能（v1.1 - 2025-10-29）
 */

import { create } from 'zustand';
import api from '../utils/api';
import { message } from 'antd';

const useTeachingStore = create((set, get) => ({
  // ==================== 状态 ====================
  
  modules: [],
  modulesPagination: {
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  },
  modulesLoading: false,
  
  groups: [],
  groupsLoading: false,
  
  groupedModules: [],
  groupedModulesLoading: false,
  
  allModules: [],
  allModulesLoading: false,
  
  currentModule: null,
  currentModuleLoading: false,
  
  lessons: [],
  lessonsLoading: false,
  
  currentLesson: null,
  currentLessonLoading: false,
  
  permissions: [],
  permissionsLoading: false,
  
  draft: null,
  draftSaving: false,
  
  // 教案相关状态（新增）
  teachingPlanSaving: false,
  teachingPlanLoading: false,
  
  // ==================== 分组操作 ====================
  
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
   * 获取单个模块详情（修复：添加权限错误处理）
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
      set({ currentModuleLoading: false });
      
      if (error.response?.status === 403) {
        const errorMsg = error.response?.data?.message || '无权查看此教学模块';
        message.error(errorMsg);
        const permissionError = new Error(errorMsg);
        permissionError.code = 'PERMISSION_DENIED';
        permissionError.status = 403;
        throw permissionError;
      }
      
      message.error(error.response?.data?.message || '获取模块详情失败');
      throw error;
    }
  },
  
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
  
  /**
   * 获取课程列表（修复：添加权限错误处理）
   */
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
      set({ lessonsLoading: false });
      
      if (error.response?.status === 403) {
        message.error(error.response?.data?.message || '无权访问此模块的课程');
      } else {
        message.error(error.response?.data?.message || '获取课程列表失败');
      }
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
      set({ currentLessonLoading: false });
      
      if (error.response?.status === 403) {
        message.error(error.response?.data?.message || '无权查看此课程');
      } else {
        message.error(error.response?.data?.message || '获取课程详情失败');
      }
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
  
  // ==================== 教案操作（新增 - v1.1）====================
  
  /**
   * 保存教案
   * @param {number} lessonId - 课程ID
   * @param {number} pageNumber - 页码（从1开始）
   * @param {string} content - 教案HTML内容
   */
  saveTeachingPlan: async (lessonId, pageNumber, content) => {
    set({ teachingPlanSaving: true });
    try {
      const response = await api.post(`/teaching/lessons/${lessonId}/teaching-plan`, {
        page_number: pageNumber,
        content: content
      });
      
      const planData = response.data.data || response.data;
      message.success('教案保存成功');
      set({ teachingPlanSaving: false });
      return planData;
    } catch (error) {
      set({ teachingPlanSaving: false });
      message.error(error.response?.data?.message || '教案保存失败');
      throw error;
    }
  },
  
  /**
   * 获取教案
   * @param {number} lessonId - 课程ID
   * @param {number} pageNumber - 页码（从1开始）
   * @returns {object|null} 教案数据或null
   */
  fetchTeachingPlan: async (lessonId, pageNumber) => {
    set({ teachingPlanLoading: true });
    try {
      const response = await api.get(`/teaching/lessons/${lessonId}/teaching-plan/${pageNumber}`);
      const planData = response.data.data || response.data;
      
      set({ teachingPlanLoading: false });
      return planData;
    } catch (error) {
      set({ teachingPlanLoading: false });
      
      // 404是正常情况（没有教案）
      if (error.response?.status === 404) {
        return null;
      }
      
      message.error(error.response?.data?.message || '教案加载失败');
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
