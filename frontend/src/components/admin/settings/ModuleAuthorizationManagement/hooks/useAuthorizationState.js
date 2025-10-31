/**
 * 状态管理 Hook
 * 负责管理授权配置的状态更新
 * 
 * @module hooks/useAuthorizationState
 */

import { useState, useCallback, useMemo } from 'react';
import { message, Modal } from 'antd';
import api from '../../../../../utils/api';
import { SUCCESS_MESSAGES, CONFIRM_MESSAGES } from '../constants';

/**
 * 授权状态管理 Hook
 * 
 * @returns {Object} 状态管理相关的状态和方法
 */
export const useAuthorizationState = () => {
  // ==================== 状态定义 ====================
  const [authorizedGroups, setAuthorizedGroups] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [groupSelectModalVisible, setGroupSelectModalVisible] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [saving, setSaving] = useState(false);

  // ==================== 状态更新方法 ====================

  /**
   * 初始化授权组数据
   * 
   * @param {Array} groups - 授权组数据
   */
  const initializeGroups = useCallback((groups) => {
    setAuthorizedGroups(groups);
    setHasUnsavedChanges(false);
  }, []);

  /**
   * 更新授权组数据（触发未保存标记）
   * 
   * @param {Function|Array} updater - 更新函数或新数据
   */
  const updateGroups = useCallback((updater) => {
    if (typeof updater === 'function') {
      setAuthorizedGroups(updater);
    } else {
      setAuthorizedGroups(updater);
    }
    setHasUnsavedChanges(true);
  }, []);

  /**
   * 添加新的授权组
   * 
   * @param {Array} newGroupIds - 新增组ID列表
   * @param {Array} allGroups - 所有组的数据
   */
  const addGroups = useCallback((newGroupIds, allGroups) => {
    if (newGroupIds.length === 0) {
      message.warning('请选择至少一个用户组');
      return;
    }

    const newGroups = newGroupIds
      .filter(gid => !authorizedGroups.find(ag => ag.groupId === gid))
      .map(gid => {
        const group = allGroups.find(g => g.id === gid);
        return {
          groupId: gid,
          groupName: group?.name || '',
          userCount: group?.user_count || 0,
          expanded: true,
          showTags: false,
          modulePermissions: [],
          tags: []
        };
      });

    setAuthorizedGroups([...authorizedGroups, ...newGroups]);
    setGroupSelectModalVisible(false);
    setHasUnsavedChanges(true);
    message.success(SUCCESS_MESSAGES.ADD_GROUPS(newGroups.length));
  }, [authorizedGroups]);

  /**
   * 移除授权组
   * 
   * @param {number} groupId - 组ID
   */
  const removeGroup = useCallback((groupId) => {
    Modal.confirm({
      ...CONFIRM_MESSAGES.REMOVE_GROUP,
      okButtonProps: { danger: true },
      onOk: () => {
        setAuthorizedGroups(authorizedGroups.filter(g => g.groupId !== groupId));
        setHasUnsavedChanges(true);
        message.success(SUCCESS_MESSAGES.REMOVE_GROUP);
      }
    });
  }, [authorizedGroups]);

  /**
   * 展开/收起组的标签列表
   * 
   * @param {number} groupId - 组ID
   * @param {Array} tags - 标签数据（如果是展开操作）
   */
  const toggleGroupTags = useCallback((groupId, tags = null) => {
    setAuthorizedGroups(prev =>
      prev.map(group => {
        if (group.groupId !== groupId) return group;
        
        if (tags && !group.showTags) {
          // 展开并合并标签数据
          const existingTags = group.tags || [];
          const mergedTags = tags.map(apiTag => {
            const existing = existingTags.find(et => et.tagId === apiTag.tagId);
            return existing ? { ...existing, ...apiTag } : apiTag;
          });
          
          return { ...group, tags: mergedTags, showTags: true };
        } else {
          // 收起
          return { ...group, showTags: !group.showTags };
        }
      })
    );
  }, []);

  /**
   * 展开/收起标签的用户列表
   * 
   * @param {number} groupId - 组ID
   * @param {number} tagId - 标签ID
   * @param {Array} users - 用户数据（如果是展开操作）
   * @param {number} page - 当前页码
   */
  const toggleTagUsers = useCallback((groupId, tagId, users = null, page = 1) => {
    setAuthorizedGroups(prev =>
      prev.map(group => {
        if (group.groupId !== groupId) return group;
        
        return {
          ...group,
          tags: group.tags.map(tag => {
            if (tag.tagId !== tagId) return tag;
            
            if (users && !tag.showUsers) {
              // 展开并合并用户数据
              const existingUsers = tag.users || [];
              const mergedUsers = users.map(u => {
                const existing = existingUsers.find(eu => eu.userId === u.userId);
                return existing ? { ...existing, ...u } : u;
              });
              
              return {
                ...tag,
                users: mergedUsers,
                showUsers: true,
                currentPage: page
              };
            } else {
              // 收起
              return { ...tag, showUsers: !tag.showUsers };
            }
          })
        };
      })
    );
  }, []);

  /**
   * 展开/收起模块的课程列表
   * 
   * @param {number} groupId - 组ID
   * @param {number} tagId - 标签ID（可选）
   * @param {number} userId - 用户ID（可选）
   * @param {number} moduleId - 模块ID
   */
  const toggleModuleExpand = useCallback((groupId, tagId, userId, moduleId) => {
    setAuthorizedGroups(prev =>
      prev.map(group => {
        if (group.groupId !== groupId) return group;

        // 组级模块展开
        if (!tagId && !userId) {
          return {
            ...group,
            modulePermissions: group.modulePermissions.map(mp =>
              mp.moduleId === moduleId ? { ...mp, expanded: !mp.expanded } : mp
            )
          };
        }

        // 标签级模块展开
        if (tagId && !userId) {
          return {
            ...group,
            tags: group.tags.map(tag =>
              tag.tagId === tagId
                ? {
                    ...tag,
                    modulePermissions: tag.modulePermissions.map(mp =>
                      mp.moduleId === moduleId ? { ...mp, expanded: !mp.expanded } : mp
                    )
                  }
                : tag
            )
          };
        }

        // 用户级模块展开
        if (userId) {
          return {
            ...group,
            tags: group.tags.map(tag =>
              tag.tagId === tagId
                ? {
                    ...tag,
                    users: tag.users.map(user =>
                      user.userId === userId
                        ? {
                            ...user,
                            modulePermissions: user.modulePermissions.map(mp =>
                              mp.moduleId === moduleId ? { ...mp, expanded: !mp.expanded } : mp
                            )
                          }
                        : user
                    )
                  }
                : tag
            )
          };
        }

        return group;
      })
    );
  }, []);

  /**
   * 保存所有授权配置
   */
  const saveAuthorizations = useCallback(async () => {
    setSaving(true);
    try {
      const configData = authorizedGroups.map(group => ({
        groupId: group.groupId,
        modulePermissions: group.modulePermissions || [],
        tags: (group.tags || []).map(tag => ({
          tagId: tag.tagId,
          inheritFromGroup: tag.inheritFromGroup,
          modulePermissions: tag.modulePermissions || [],
          users: (tag.users || []).map(user => ({
            userId: user.userId,
            inheritFromTag: user.inheritFromTag,
            modulePermissions: user.modulePermissions || []
          }))
        }))
      }));

      await api.post('/teaching/authorization/save', { authorizations: configData });
      
      message.success(SUCCESS_MESSAGES.SAVE);
      setHasUnsavedChanges(false);
      return true;
    } catch (error) {
      console.error('保存失败:', error);
      message.error(error.response?.data?.message || '保存授权配置失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, [authorizedGroups]);

  /**
   * 重置为上次保存的状态
   * 
   * @param {Function} reloadCallback - 重新加载数据的回调
   */
  const resetChanges = useCallback((reloadCallback) => {
    Modal.confirm({
      ...CONFIRM_MESSAGES.RESET,
      okButtonProps: { danger: true },
      onOk: async () => {
        await reloadCallback();
        setHasUnsavedChanges(false);
        message.info(SUCCESS_MESSAGES.RESET);
      }
    });
  }, []);

  // ==================== 派生状态 ====================
  const hasAuthorizedGroups = useMemo(
    () => authorizedGroups.length > 0,
    [authorizedGroups]
  );

  // ==================== 返回值 ====================
  return {
    // 状态
    authorizedGroups,
    hasUnsavedChanges,
    groupSelectModalVisible,
    selectedGroups,
    saving,
    hasAuthorizedGroups,
    
    // 状态设置器
    setGroupSelectModalVisible,
    setSelectedGroups,
    
    // 方法
    initializeGroups,
    updateGroups,
    addGroups,
    removeGroup,
    toggleGroupTags,
    toggleTagUsers,
    toggleModuleExpand,
    saveAuthorizations,
    resetChanges
  };
};
