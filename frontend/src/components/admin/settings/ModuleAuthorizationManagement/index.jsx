/**
 * 智能教学授权管理 - 主容器组件（重构版 v3.0.0）
 * 
 * 重构日期：2025-11-01
 * 重构目标：
 * ✅ 从1900行拆分为模块化架构
 * ✅ 每个文件 <600 行，符合代码规范
 * ✅ 职责分离：工具/常量/Hooks/组件
 * ✅ 可维护、可测试、可扩展
 * 
 * 架构说明：
 * - utils/：纯函数工具（deepCopy, permissionCalculator, migration）
 * - constants/：常量定义（权限类型、UI文案）
 * - hooks/：自定义Hooks（数据加载、状态管理、权限逻辑）
 * - components/：UI组件（8个独立组件）
 * - index.jsx：主容器（当前文件，仅负责组合）
 * 
 * @module ModuleAuthorizationManagement
 * @version 3.0.0
 */

import React, { useEffect } from 'react';
import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';

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

/**
 * 智能教学授权管理主容器
 * 
 * 功能：
 * 1. 管理组织、标签、用户的三级授权配置
 * 2. 支持三级权限体系（view_lesson/view_plan/edit）
 * 3. 支持权限继承和独立配置
 * 4. 支持模块和课程级别的细粒度控制
 */
const ModuleAuthorizationManagement = () => {
  const { t } = useTranslation();

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
    await loadInitialData();
    const groups = await loadAuthorizations();
    initializeGroups(groups);
  };

  // ==================== 事件处理器 ====================

  /**
   * 刷新数据
   */
  const handleRefresh = async () => {
    await loadInitialData();
    const groups = await loadAuthorizations();
    initializeGroups(groups);
  };

  /**
   * 打开组织选择弹窗
   */
  const handleOpenGroupSelect = () => {
    setSelectedGroups([]);
    setGroupSelectModalVisible(true);
  };

  /**
   * 添加组织
   */
  const handleAddGroups = () => {
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
   * 保存授权配置
   */
  const handleSave = async () => {
    const success = await saveAuthorizations();
    if (success) {
      // 保存成功后重新加载
      const groups = await loadAuthorizations();
      initializeGroups(groups);
    }
  };

  /**
   * 重置更改
   */
  const handleReset = () => {
    resetChanges(async () => {
      const groups = await loadAuthorizations();
      initializeGroups(groups);
    });
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

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* 权限说明 */}
      <PermissionHelpAlert />

      {/* 顶部操作栏 */}
      <OperationBar
        onNewAuth={handleOpenGroupSelect}
        onRefresh={handleRefresh}
        onReset={handleReset}
        onSave={handleSave}
        loading={dataLoading}
        saving={saving}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* 组织列表 */}
      <GroupList
        groups={authorizedGroups}
        allModules={allModules}
        moduleLessons={moduleLessons}
        loadingLessons={loadingLessons}
        userPagination={userPagination}
        loadingUsers={loadingUsers}
        onNewAuth={handleOpenGroupSelect}
        onRemoveGroup={removeGroup}
        onPermissionToggle={togglePermission}
        onInheritanceToggle={toggleInheritance}
        onModuleExpand={toggleModuleExpand}
        onLoadLessons={loadModuleLessons}
        onToggleTags={handleToggleTags}
        onToggleUsers={handleToggleUsers}
        onLoadUsers={handleLoadUsers}
      />

      {/* 选择组织弹窗 */}
      <GroupSelectModal
        visible={groupSelectModalVisible}
        allGroups={allGroups}
        selectedGroups={selectedGroups}
        onSelectedChange={setSelectedGroups}
        onOk={handleAddGroups}
        onCancel={() => setGroupSelectModalVisible(false)}
      />
    </div>
  );
};

export default ModuleAuthorizationManagement;
