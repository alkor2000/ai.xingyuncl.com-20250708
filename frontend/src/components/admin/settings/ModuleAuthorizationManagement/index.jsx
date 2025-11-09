/**
 * 智能教学授权管理 - 主容器组件（v3.1.0）
 * 
 * 版本更新：
 * - v3.1.0 (2025-11-09): 添加权限边界检查
 *   * 组管理员只能看到被授权的模块
 *   * 组管理员不能授予超过上限的权限
 *   * 添加权限上限指示器
 * - v3.0.0: 模块化重构
 * 
 * 架构说明：
 * - utils/：纯函数工具（含权限边界检查）
 * - constants/：常量定义
 * - hooks/：自定义Hooks
 * - components/：UI组件
 * - index.jsx：主容器
 * 
 * @module ModuleAuthorizationManagement
 * @version 3.1.0
 */

import React, { useEffect, useState } from 'react';
import { Spin, message } from 'antd';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../../../stores/authStore';

// 自定义 Hooks
import {
  useAuthorizationData,
  useAuthorizationState,
  usePermissionLogic
} from './hooks';

// UI 组件
import {
  PermissionHelpAlert,
  OperationBar,
  GroupSelectModal,
  GroupList
} from './components';

// 常量
import { LOADING_MESSAGES } from './constants';

// 工具函数
import { validatePermissionConfig } from './utils';

/**
 * 智能教学授权管理主容器
 * 
 * 功能：
 * 1. 管理组织、标签、用户的三级授权配置
 * 2. 支持三级权限体系（view_lesson/view_plan/edit）
 * 3. 支持权限继承和独立配置
 * 4. 支持模块和课程级别的细粒度控制
 * 5. 【新增】权限边界检查，防止越权
 */
const ModuleAuthorizationManagement = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  
  // 判断是否为组管理员
  const isGroupAdmin = user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const userGroupId = user?.group_id;

  // ==================== 数据加载 Hook ====================
  const {
    loading: dataLoading,
    allGroups,
    allModules,
    moduleLessons,
    loadingLessons,
    userPagination,
    loadingUsers,
    loadInitialData,
    loadAuthorizations,
    loadModuleLessons,
    loadGroupTags,
    loadTagUsers
  } = useAuthorizationData();

  // ==================== 状态管理 Hook ====================
  const {
    authorizedGroups,
    hasUnsavedChanges,
    groupSelectModalVisible,
    selectedGroups,
    saving,
    hasAuthorizedGroups,
    setGroupSelectModalVisible,
    setSelectedGroups,
    initializeGroups,
    updateGroups,
    addGroups,
    removeGroup,
    toggleGroupTags,
    toggleTagUsers,
    toggleModuleExpand,
    saveAuthorizations,
    resetChanges
  } = useAuthorizationState();

  // ==================== 新增：权限上限状态 ====================
  const [permissionLimits, setPermissionLimits] = useState({});
  const [superAdminConfig, setSuperAdminConfig] = useState(null);

  // ==================== 权限逻辑 Hook ====================
  const {
    togglePermission,
    toggleInheritance
  } = usePermissionLogic(updateGroups, allModules, moduleLessons);

  // ==================== 初始化数据 ====================
  useEffect(() => {
    initializeData();
  }, []);

  const initializeData = async () => {
    // 加载基础数据
    const { modules } = await loadInitialData();
    
    // 加载授权配置
    const groups = await loadAuthorizations();
    
    // 如果是组管理员，需要加载超级管理员的配置作为权限上限
    if (isGroupAdmin) {
      await loadPermissionLimits();
      
      // 过滤模块列表，只显示被授权的模块
      const authorizedModuleIds = new Set();
      if (superAdminConfig && superAdminConfig.modulePermissions) {
        superAdminConfig.modulePermissions.forEach(mp => {
          authorizedModuleIds.add(mp.moduleId);
        });
      }
      
      // 过滤并初始化组（组管理员只能看到本组）
      const filteredGroups = groups.filter(g => g.groupId === userGroupId);
      initializeGroups(filteredGroups);
    } else {
      // 超级管理员看到所有数据
      initializeGroups(groups);
    }
  };

  /**
   * 加载权限上限（组管理员专用）
   */
  const loadPermissionLimits = async () => {
    if (!isGroupAdmin) return;
    
    try {
      // 获取超级管理员对本组的授权配置
      const response = await fetch('/api/teaching/authorization/super-admin-config', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setSuperAdminConfig(data.config);
        
        // 构建权限上限映射
        const limits = {};
        if (data.config && data.config.modulePermissions) {
          data.config.modulePermissions.forEach(mp => {
            limits[mp.moduleId] = {
              view_lesson: mp.view_lesson || false,
              view_plan: mp.view_plan || false,
              edit: mp.edit || false,
              lessons: mp.lessons || []
            };
          });
        }
        setPermissionLimits(limits);
      }
    } catch (error) {
      console.error('加载权限上限失败:', error);
      message.warning('无法加载权限上限，部分功能可能受限');
    }
  };

  // ==================== 事件处理器 ====================

  /**
   * 刷新数据
   */
  const handleRefresh = async () => {
    await initializeData();
  };

  /**
   * 打开组织选择弹窗（组管理员不能添加新组织）
   */
  const handleOpenGroupSelect = () => {
    if (isGroupAdmin) {
      message.warning('组管理员不能添加新的授权组织');
      return;
    }
    setSelectedGroups([]);
    setGroupSelectModalVisible(true);
  };

  /**
   * 添加组织
   */
  const handleAddGroups = () => {
    if (isGroupAdmin) {
      message.warning('组管理员不能添加新的授权组织');
      return;
    }
    addGroups(selectedGroups, allGroups);
  };

  /**
   * 展开/收起标签列表
   */
  const handleToggleTags = async (groupId) => {
    const group = authorizedGroups.find(g => g.groupId === groupId);
    
    if (group && !group.showTags) {
      // 首次展开，加载标签数据
      const tags = await loadGroupTags(groupId);
      toggleGroupTags(groupId, tags);
    } else {
      // 收起
      toggleGroupTags(groupId);
    }
  };

  /**
   * 展开/收起用户列表
   */
  const handleToggleUsers = async (groupId, tagId) => {
    const group = authorizedGroups.find(g => g.groupId === groupId);
    const tag = group?.tags?.find(t => t.tagId === tagId);
    
    if (tag && !tag.showUsers) {
      // 首次展开，加载用户数据
      const users = await loadTagUsers(groupId, tagId, 1);
      toggleTagUsers(groupId, tagId, users, 1);
    } else {
      // 收起
      toggleTagUsers(groupId, tagId);
    }
  };

  /**
   * 加载用户（分页）
   */
  const handleLoadUsers = async (groupId, tagId, page) => {
    const users = await loadTagUsers(groupId, tagId, page);
    toggleTagUsers(groupId, tagId, users, page);
  };

  /**
   * 保存授权配置（增强：权限验证）
   */
  const handleSave = async () => {
    // 如果是组管理员，验证权限是否超限
    if (isGroupAdmin && superAdminConfig) {
      let hasError = false;
      
      for (const group of authorizedGroups) {
        // 验证组级权限
        const validation = validatePermissionConfig(
          { modulePermissions: group.modulePermissions },
          superAdminConfig
        );
        
        if (!validation.valid) {
          message.error(`组权限配置错误：${validation.errors.join(', ')}`);
          hasError = true;
          break;
        }
        
        // 验证标签级权限
        for (const tag of group.tags || []) {
          if (!tag.inheritFromGroup) {
            const tagValidation = validatePermissionConfig(
              { modulePermissions: tag.modulePermissions },
              superAdminConfig
            );
            
            if (!tagValidation.valid) {
              message.error(`标签 "${tag.tagName}" 权限配置错误：${tagValidation.errors.join(', ')}`);
              hasError = true;
              break;
            }
          }
        }
        
        if (hasError) break;
      }
      
      if (hasError) {
        return;
      }
    }
    
    // 执行保存
    const success = await saveAuthorizations();
    if (success) {
      // 保存成功后重新加载
      await initializeData();
    }
  };

  /**
   * 重置更改
   */
  const handleReset = () => {
    resetChanges(async () => {
      await initializeData();
    });
  };

  /**
   * 增强的权限切换（带权限边界检查）
   */
  const handlePermissionToggle = (
    groupId,
    tagId,
    userId,
    moduleId,
    lessonId,
    permType,
    currentValue
  ) => {
    // 如果是组管理员，检查权限上限
    if (isGroupAdmin && permissionLimits[moduleId]) {
      const limit = permissionLimits[moduleId];
      
      // 检查是否超过上限
      if (!currentValue && !limit[permType]) {
        message.warning(`无法授予该权限：超过超级管理员授权范围`);
        return;
      }
    }
    
    // 执行原始的权限切换
    togglePermission(
      groupId,
      tagId,
      userId,
      moduleId,
      lessonId,
      permType,
      currentValue
    );
  };

  // ==================== 渲染 ====================

  // 初始加载中
  if (dataLoading && !hasAuthorizedGroups) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" tip={LOADING_MESSAGES.LOADING_DATA} />
      </div>
    );
  }

  // 组管理员：过滤出被授权的模块
  let displayModules = allModules;
  if (isGroupAdmin && superAdminConfig) {
    const authorizedModuleIds = new Set();
    superAdminConfig.modulePermissions?.forEach(mp => {
      authorizedModuleIds.add(mp.moduleId);
    });
    displayModules = allModules.filter(m => authorizedModuleIds.has(m.id));
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* 权限说明 */}
      <PermissionHelpAlert 
        isGroupAdmin={isGroupAdmin}
        showLimitInfo={isGroupAdmin}
      />

      {/* 顶部操作栏 */}
      <OperationBar
        onNewAuth={handleOpenGroupSelect}
        onRefresh={handleRefresh}
        onReset={handleReset}
        onSave={handleSave}
        loading={dataLoading}
        saving={saving}
        hasUnsavedChanges={hasUnsavedChanges}
        canAddAuth={!isGroupAdmin} // 组管理员不能添加新授权
      />

      {/* 组织列表 */}
      <GroupList
        groups={authorizedGroups}
        allModules={displayModules} // 使用过滤后的模块列表
        moduleLessons={moduleLessons}
        loadingLessons={loadingLessons}
        userPagination={userPagination}
        loadingUsers={loadingUsers}
        permissionLimits={permissionLimits} // 传递权限上限
        isGroupAdmin={isGroupAdmin}
        onNewAuth={handleOpenGroupSelect}
        onRemoveGroup={removeGroup}
        onPermissionToggle={handlePermissionToggle} // 使用增强的权限切换
        onInheritanceToggle={toggleInheritance}
        onModuleExpand={toggleModuleExpand}
        onLoadLessons={loadModuleLessons}
        onToggleTags={handleToggleTags}
        onToggleUsers={handleToggleUsers}
        onLoadUsers={handleLoadUsers}
      />

      {/* 选择组织弹窗（组管理员不显示）*/}
      {!isGroupAdmin && (
        <GroupSelectModal
          visible={groupSelectModalVisible}
          allGroups={allGroups}
          selectedGroups={selectedGroups}
          onSelectedChange={setSelectedGroups}
          onOk={handleAddGroups}
          onCancel={() => setGroupSelectModalVisible(false)}
        />
      )}
    </div>
  );
};

export default ModuleAuthorizationManagement;
