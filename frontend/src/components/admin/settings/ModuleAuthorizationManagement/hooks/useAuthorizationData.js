/**
 * 数据加载 Hook
 * 负责加载所有授权管理所需的数据
 * 
 * 版本更新：
 * - v1.3.0 (2025-11-09): 支持组管理员数据过滤
 *   * 组管理员只能看到本组的数据
 *   * 组管理员只能操作已被授权的模块
 * 
 * @module hooks/useAuthorizationData
 */

import { useState, useCallback } from 'react';
import { message } from 'antd';
import api from '../../../../../utils/api';
import useAuthStore from '../../../../../stores/authStore';
import { migrateAuthorizationConfig, migrateTags } from '../utils';

/**
 * 授权数据加载 Hook
 * 
 * @returns {Object} 数据加载相关的状态和方法
 */
export const useAuthorizationData = () => {
  // ==================== 状态定义 ====================
  const [loading, setLoading] = useState(false);
  const [allGroups, setAllGroups] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [moduleLessons, setModuleLessons] = useState({});
  const [loadingLessons, setLoadingLessons] = useState({});
  const [tagUsers, setTagUsers] = useState({});
  const [userPagination, setUserPagination] = useState({});
  const [loadingUsers, setLoadingUsers] = useState({});

  // 获取当前用户信息
  const { user } = useAuthStore();
  const isGroupAdmin = user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const userGroupId = user?.group_id;

  // ==================== 数据加载方法 ====================

  /**
   * 加载所有用户组
   * 组管理员只返回本组数据
   */
  const loadGroups = useCallback(async () => {
    try {
      // 如果是组管理员，只返回本组
      if (isGroupAdmin) {
        const response = await api.get('/admin/user-groups');
        const allGroupsData = response.data.data || [];
        // 过滤出本组
        const myGroup = allGroupsData.find(g => g.id === userGroupId);
        const groups = myGroup ? [myGroup] : [];
        setAllGroups(groups);
        return groups;
      }

      // 超级管理员获取所有组
      const response = await api.get('/admin/user-groups');
      const groups = response.data.data || [];
      setAllGroups(Array.isArray(groups) ? groups : []);
      return groups;
    } catch (error) {
      console.error('加载用户组失败:', error);
      message.error('获取用户组列表失败');
      return [];
    }
  }, [isGroupAdmin, userGroupId]);

  /**
   * 加载所有已发布的教学模块
   * 组管理员只加载已被授权的模块
   */
  const loadModules = useCallback(async () => {
    try {
      let modules = [];

      if (isGroupAdmin) {
        // 组管理员：获取本组已被授权的模块
        const response = await api.get('/teaching/admin/modules', {
          params: { limit: 1000 }
        });
        const modulesData = response.data.data?.modules || response.data.data || [];
        modules = Array.isArray(modulesData)
          ? modulesData.filter(m => m.status === 'published')
          : [];
      } else {
        // 超级管理员：获取所有已发布的模块
        const response = await api.get('/teaching/admin/modules', {
          params: { limit: 1000 }
        });
        const modulesData = response.data.data?.modules || response.data.data || [];
        modules = Array.isArray(modulesData)
          ? modulesData.filter(m => m.status === 'published')
          : [];
      }

      setAllModules(modules);
      return modules;
    } catch (error) {
      console.error('加载模块失败:', error);
      message.error('获取模块列表失败');
      return [];
    }
  }, [isGroupAdmin]);

  /**
   * 加载授权配置
   * 组管理员只加载本组的配置
   * 
   * @returns {Array} 格式化后的授权组配置
   */
  const loadAuthorizations = useCallback(async () => {
    try {
      const response = await api.get('/teaching/authorization');
      let authorizations = response.data.data || [];
      
      // 如果是组管理员，只返回本组的授权配置
      if (isGroupAdmin) {
        authorizations = authorizations.filter(auth => auth.groupId === userGroupId);
      }
      
      // 格式化并迁移数据
      const formattedGroups = authorizations.map(auth => {
        const migratedConfig = migrateAuthorizationConfig(auth.config || {});
        
        return {
          groupId: auth.groupId,
          groupName: auth.groupName,
          userCount: auth.userCount,
          expanded: false,
          showTags: false,
          modulePermissions: migratedConfig.modulePermissions || [],
          tags: migrateTags(migratedConfig.tags || []).map(tag => ({
            ...tag,
            showUsers: false,
            expanded: false
          }))
        };
      });
      
      return formattedGroups;
    } catch (error) {
      console.error('加载授权配置失败:', error);
      message.error('获取授权配置失败');
      return [];
    }
  }, [isGroupAdmin, userGroupId]);

  /**
   * 加载初始数据（组、模块、授权配置）
   */
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [groups, modules] = await Promise.all([
        loadGroups(),
        loadModules()
      ]);
      
      return { groups, modules };
    } catch (error) {
      console.error('加载初始数据失败:', error);
      message.error('加载数据失败');
      return { groups: [], modules: [] };
    } finally {
      setLoading(false);
    }
  }, [loadGroups, loadModules]);

  /**
   * 加载指定模块的课程列表
   * 
   * @param {number} moduleId - 模块ID
   */
  const loadModuleLessons = useCallback(async (moduleId) => {
    // 如果已经加载过，直接返回
    if (moduleLessons[moduleId]) {
      return moduleLessons[moduleId];
    }

    // 组管理员检查：确保模块在已授权列表中
    if (isGroupAdmin) {
      const isAuthorized = allModules.some(m => m.id === moduleId);
      if (!isAuthorized) {
        console.warn('组管理员尝试访问未授权的模块课程:', moduleId);
        message.warning('无权访问此模块的课程');
        return [];
      }
    }

    setLoadingLessons(prev => ({ ...prev, [moduleId]: true }));
    try {
      const response = await api.get(`/teaching/modules/${moduleId}/lessons-for-auth`);
      const lessons = response.data.data || [];
      
      setModuleLessons(prev => ({
        ...prev,
        [moduleId]: lessons
      }));
      
      return lessons;
    } catch (error) {
      console.error('加载课程列表失败:', error);
      message.error('加载课程列表失败');
      return [];
    } finally {
      setLoadingLessons(prev => ({ ...prev, [moduleId]: false }));
    }
  }, [moduleLessons, isGroupAdmin, allModules]);

  /**
   * 加载指定组织的标签列表
   * 组管理员只能加载本组的标签
   * 
   * @param {number} groupId - 组织ID
   */
  const loadGroupTags = useCallback(async (groupId) => {
    // 组管理员权限检查
    if (isGroupAdmin && groupId !== userGroupId) {
      console.warn('组管理员尝试访问其他组的标签:', groupId);
      message.warning('无权访问其他组的标签');
      return [];
    }

    try {
      const response = await api.get(`/admin/user-tags/group/${groupId}`);
      const apiTags = (response.data.data || []).filter(t => t.is_active);
      
      return apiTags.map(tag => ({
        tagId: tag.id,
        tagName: tag.name,
        tagColor: tag.color,
        userCount: tag.user_count || 0,
        expanded: false,
        showUsers: false,
        inheritFromGroup: true,
        modulePermissions: [],
        users: []
      }));
    } catch (error) {
      console.error('加载标签失败:', error);
      message.error('加载标签失败');
      return [];
    }
  }, [isGroupAdmin, userGroupId]);

  /**
   * 加载指定标签下的用户列表（分页）
   * 组管理员只能加载本组标签的用户
   * 
   * @param {number} groupId - 组织ID
   * @param {number} tagId - 标签ID
   * @param {number} page - 页码
   */
  const loadTagUsers = useCallback(async (groupId, tagId, page = 1) => {
    // 组管理员权限检查
    if (isGroupAdmin && groupId !== userGroupId) {
      console.warn('组管理员尝试访问其他组标签的用户:', groupId, tagId);
      message.warning('无权访问其他组标签的用户');
      return [];
    }

    const key = `${groupId}-${tagId}`;
    setLoadingUsers(prev => ({ ...prev, [key]: true }));
    
    try {
      const response = await api.get(`/teaching/tags/${tagId}/users`, {
        params: { page, limit: 20 }
      });
      
      const { users, pagination } = response.data.data;
      
      // 缓存用户数据
      setTagUsers(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [page]: users
        }
      }));
      
      // 保存分页信息
      setUserPagination(prev => ({
        ...prev,
        [key]: pagination
      }));

      // 格式化用户数据
      return users.map(u => ({
        userId: u.id,
        username: u.username,
        email: u.email,
        remark: u.remark,
        inheritFromTag: true,
        modulePermissions: []
      }));
    } catch (error) {
      console.error('加载用户列表失败:', error);
      message.error('加载用户列表失败');
      return [];
    } finally {
      setLoadingUsers(prev => ({ ...prev, [key]: false }));
    }
  }, [isGroupAdmin, userGroupId]);

  // ==================== 返回值 ====================
  return {
    // 状态
    loading,
    allGroups,
    allModules,
    moduleLessons,
    loadingLessons,
    tagUsers,
    userPagination,
    loadingUsers,
    
    // 用户信息
    isGroupAdmin,
    isSuperAdmin,
    userGroupId,
    
    // 方法
    loadInitialData,
    loadGroups,
    loadModules,
    loadAuthorizations,
    loadModuleLessons,
    loadGroupTags,
    loadTagUsers
  };
};
