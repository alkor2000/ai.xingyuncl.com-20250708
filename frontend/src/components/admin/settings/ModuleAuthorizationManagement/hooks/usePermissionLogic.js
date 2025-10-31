/**
 * 权限逻辑 Hook
 * 负责处理权限的切换、继承、级联计算
 * 
 * @module hooks/usePermissionLogic
 */

import { useCallback } from 'react';
import { message } from 'antd';
import { 
  deepCopyPermissions, 
  calculateGrantPermissions, 
  calculateRevokePermissions 
} from '../utils';
import { SUCCESS_MESSAGES } from '../constants';

/**
 * 权限逻辑管理 Hook
 * 
 * @param {Function} updateGroups - 更新组数据的函数
 * @param {Object} allModules - 所有模块数据
 * @param {Object} moduleLessons - 模块课程数据
 * @returns {Object} 权限操作相关的方法
 */
export const usePermissionLogic = (updateGroups, allModules, moduleLessons) => {
  /**
   * 切换模块/课程权限（核心函数）
   * 
   * @param {number} groupId - 组ID
   * @param {number|null} tagId - 标签ID（可选）
   * @param {number|null} userId - 用户ID（可选）
   * @param {number} moduleId - 模块ID
   * @param {number|null} lessonId - 课程ID（可选）
   * @param {string} permType - 权限类型（view_lesson/view_plan/edit）
   * @param {boolean} currentValue - 当前权限值
   */
  const togglePermission = useCallback((
    groupId, 
    tagId, 
    userId, 
    moduleId, 
    lessonId, 
    permType, 
    currentValue
  ) => {
    updateGroups(prev => {
      return prev.map(group => {
        if (group.groupId !== groupId) return group;

        // 组级权限操作
        if (!tagId && !userId) {
          return updateGroupPermission(group, moduleId, lessonId, permType, currentValue, allModules, moduleLessons);
        }

        // 标签级权限操作
        if (tagId && !userId) {
          return updateTagPermission(group, tagId, moduleId, lessonId, permType, currentValue, allModules, moduleLessons);
        }

        // 用户级权限操作
        if (userId) {
          return updateUserPermission(group, tagId, userId, moduleId, lessonId, permType, currentValue, allModules, moduleLessons);
        }

        return group;
      });
    });
  }, [updateGroups, allModules, moduleLessons]);

  /**
   * 切换继承开关
   * 
   * @param {number} groupId - 组ID
   * @param {number|null} tagId - 标签ID（可选，标签继承组权限）
   * @param {number|null} userId - 用户ID（可选，用户继承标签权限）
   * @param {boolean} checked - 是否继承
   * @param {Object} sourcePermissions - 上级权限（用于复制）
   */
  const toggleInheritance = useCallback((groupId, tagId, userId, checked, sourcePermissions) => {
    updateGroups(prev => {
      return prev.map(group => {
        if (group.groupId !== groupId) return group;

        // 标签继承组权限
        if (tagId && !userId) {
          return {
            ...group,
            tags: group.tags.map(tag =>
              tag.tagId === tagId
                ? {
                    ...tag,
                    inheritFromGroup: checked,
                    // 取消继承时复制组权限
                    modulePermissions: checked
                      ? []
                      : deepCopyPermissions(sourcePermissions || group.modulePermissions)
                  }
                : tag
            )
          };
        }

        // 用户继承标签权限
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
                            inheritFromTag: checked,
                            // 取消继承时复制标签权限
                            modulePermissions: checked
                              ? []
                              : deepCopyPermissions(
                                  sourcePermissions || 
                                  (tag.inheritFromGroup ? group.modulePermissions : tag.modulePermissions)
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
      });
    });

    if (!checked) {
      message.success(SUCCESS_MESSAGES.COPY_PERMISSIONS);
    }
  }, [updateGroups]);

  return {
    togglePermission,
    toggleInheritance
  };
};

// ==================== 内部辅助函数 ====================

/**
 * 更新组级权限
 */
function updateGroupPermission(group, moduleId, lessonId, permType, currentValue, allModules, moduleLessons) {
  const modulePerms = group.modulePermissions || [];
  const existingIndex = modulePerms.findIndex(mp => mp.moduleId === moduleId);

  // 模块级权限操作
  if (!lessonId) {
    return updateModuleLevelPermission(
      group, 
      modulePerms, 
      existingIndex, 
      moduleId, 
      permType, 
      currentValue, 
      allModules
    );
  }

  // 课程级权限操作
  return updateLessonLevelPermission(
    group, 
    modulePerms, 
    existingIndex, 
    moduleId, 
    lessonId, 
    permType, 
    currentValue, 
    moduleLessons
  );
}

/**
 * 更新标签级权限
 */
function updateTagPermission(group, tagId, moduleId, lessonId, permType, currentValue, allModules, moduleLessons) {
  return {
    ...group,
    tags: group.tags.map(tag => {
      if (tag.tagId !== tagId) return tag;
      
      const updatedTag = updateGroupPermission(tag, moduleId, lessonId, permType, currentValue, allModules, moduleLessons);
      return {
        ...tag,
        modulePermissions: updatedTag.modulePermissions
      };
    })
  };
}

/**
 * 更新用户级权限
 */
function updateUserPermission(group, tagId, userId, moduleId, lessonId, permType, currentValue, allModules, moduleLessons) {
  return {
    ...group,
    tags: group.tags.map(tag => {
      if (tag.tagId !== tagId) return tag;
      
      return {
        ...tag,
        users: tag.users.map(user => {
          if (user.userId !== userId) return user;
          
          const updatedUser = updateGroupPermission(user, moduleId, lessonId, permType, currentValue, allModules, moduleLessons);
          return {
            ...user,
            modulePermissions: updatedUser.modulePermissions
          };
        })
      };
    })
  };
}

/**
 * 更新模块级权限
 */
function updateModuleLevelPermission(entity, modulePerms, existingIndex, moduleId, permType, currentValue, allModules) {
  const updated = [...modulePerms];

  if (currentValue) {
    // 撤销权限（级联撤销上级权限）
    if (existingIndex >= 0) {
      const revokePerms = calculateRevokePermissions(permType);
      revokePerms.forEach(perm => {
        delete updated[existingIndex][perm];
      });

      // 如果所有权限都被撤销，删除该模块配置
      if (!updated[existingIndex].view_lesson && !updated[existingIndex].view_plan && !updated[existingIndex].edit) {
        updated.splice(existingIndex, 1);
      }
    }
  } else {
    // 授予权限（级联授予下级权限）
    const grantPerms = calculateGrantPermissions(permType);

    if (existingIndex >= 0) {
      updated[existingIndex] = {
        ...updated[existingIndex],
        ...grantPerms
      };
    } else {
      // 新建模块权限配置
      updated.push({
        moduleId,
        moduleName: allModules.find(m => m.id === moduleId)?.name || '',
        expanded: false,
        lessons: [],
        ...grantPerms
      });
    }
  }

  return {
    ...entity,
    modulePermissions: updated
  };
}

/**
 * 更新课程级权限
 */
function updateLessonLevelPermission(entity, modulePerms, existingIndex, moduleId, lessonId, permType, currentValue, moduleLessons) {
  if (existingIndex < 0) {
    // 模块不存在，不处理课程权限
    return entity;
  }

  const modulePerm = modulePerms[existingIndex];
  const lessons = modulePerm.lessons || [];
  const lessonIndex = lessons.findIndex(l => l.lessonId === lessonId);

  const updated = [...modulePerms];
  const updatedLessons = [...lessons];

  if (currentValue) {
    // 撤销课程权限
    const revokePerms = calculateRevokePermissions(permType);
    
    if (lessonIndex >= 0) {
      revokePerms.forEach(perm => {
        updatedLessons[lessonIndex][perm] = false;
      });
      updatedLessons[lessonIndex].inheritFromModule = false;
    } else {
      // 创建显式拒绝配置
      const newLesson = {
        lessonId,
        lessonTitle: moduleLessons[moduleId]?.find(l => l.id === lessonId)?.title || '',
        inheritFromModule: false
      };
      revokePerms.forEach(perm => {
        newLesson[perm] = false;
      });
      updatedLessons.push(newLesson);
    }
  } else {
    // 授予课程权限
    const grantPerms = calculateGrantPermissions(permType);
    
    if (lessonIndex >= 0) {
      updatedLessons[lessonIndex] = {
        ...updatedLessons[lessonIndex],
        ...grantPerms,
        inheritFromModule: false
      };
    } else {
      // 创建新课程权限配置
      updatedLessons.push({
        lessonId,
        lessonTitle: moduleLessons[moduleId]?.find(l => l.id === lessonId)?.title || '',
        inheritFromModule: false,
        ...grantPerms
      });
    }
  }

  updated[existingIndex] = {
    ...modulePerm,
    lessons: updatedLessons
  };

  return {
    ...entity,
    modulePermissions: updated
  };
}
