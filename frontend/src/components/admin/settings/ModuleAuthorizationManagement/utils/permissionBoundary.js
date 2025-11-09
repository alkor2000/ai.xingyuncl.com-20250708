/**
 * 权限边界检查工具
 * 用于确保下级权限不超过上级权限
 * 
 * 版本：v1.0.0 (2025-11-09)
 * 功能：
 * 1. 检查权限是否越界
 * 2. 获取权限上限
 * 3. 计算可用权限选项
 * 
 * @module utils/permissionBoundary
 */

import { PERMISSION_LEVELS } from '../constants/permissionTypes';

/**
 * 权限级别数值映射（用于比较）
 */
const PERMISSION_VALUES = {
  [PERMISSION_LEVELS.VIEW_LESSON]: 1,
  [PERMISSION_LEVELS.VIEW_PLAN]: 2,
  [PERMISSION_LEVELS.EDIT]: 3
};

/**
 * 获取权限的数值
 * @param {string} permission - 权限类型
 * @returns {number} 权限数值
 */
export const getPermissionValue = (permission) => {
  return PERMISSION_VALUES[permission] || 0;
};

/**
 * 检查请求的权限是否超过上限
 * @param {string} requested - 请求的权限
 * @param {string} maximum - 最大允许权限
 * @returns {boolean} 是否超过上限
 */
export const isPermissionExceeded = (requested, maximum) => {
  if (!maximum) return true; // 没有授权则都超限
  return getPermissionValue(requested) > getPermissionValue(maximum);
};

/**
 * 获取模块的最高权限
 * @param {Object} modulePermission - 模块权限配置
 * @returns {string|null} 最高权限类型
 */
export const getMaxPermission = (modulePermission) => {
  if (!modulePermission) return null;
  
  if (modulePermission.edit) return PERMISSION_LEVELS.EDIT;
  if (modulePermission.view_plan) return PERMISSION_LEVELS.VIEW_PLAN;
  if (modulePermission.view_lesson) return PERMISSION_LEVELS.VIEW_LESSON;
  
  return null;
};

/**
 * 根据上限获取可用的权限选项
 * @param {string} maxPermission - 最大允许权限
 * @returns {Array<string>} 可用的权限类型列表
 */
export const getAvailablePermissions = (maxPermission) => {
  if (!maxPermission) return [];
  
  const maxValue = getPermissionValue(maxPermission);
  const available = [];
  
  Object.entries(PERMISSION_VALUES).forEach(([perm, value]) => {
    if (value <= maxValue) {
      available.push(perm);
    }
  });
  
  return available;
};

/**
 * 检查权限复选框是否应该被禁用
 * @param {string} permission - 要检查的权限
 * @param {string} maxPermission - 最大允许权限
 * @param {Object} currentPermissions - 当前已有权限
 * @returns {boolean} 是否应该禁用
 */
export const shouldDisablePermission = (permission, maxPermission, currentPermissions = {}) => {
  // 1. 超过上限的权限必须禁用
  if (isPermissionExceeded(permission, maxPermission)) {
    return true;
  }
  
  // 2. 级联规则：如果有更高级权限已选中，则低级权限禁用
  // 例如：如果已选中"编辑"，则"查看课程"和"查看教案"应该禁用
  if (permission === PERMISSION_LEVELS.VIEW_LESSON) {
    return currentPermissions.view_plan || currentPermissions.edit;
  }
  
  if (permission === PERMISSION_LEVELS.VIEW_PLAN) {
    return currentPermissions.edit;
  }
  
  return false;
};

/**
 * 限制权限配置到允许范围内
 * @param {Object} permissions - 权限配置
 * @param {Object} maxPermissions - 最大权限配置
 * @returns {Object} 限制后的权限配置
 */
export const limitPermissions = (permissions, maxPermissions) => {
  if (!permissions || !maxPermissions) return {};
  
  const limited = {};
  
  // 只保留不超过上限的权限
  if (permissions.view_lesson && maxPermissions.view_lesson) {
    limited.view_lesson = true;
  }
  
  if (permissions.view_plan && maxPermissions.view_plan) {
    limited.view_plan = true;
  }
  
  if (permissions.edit && maxPermissions.edit) {
    limited.edit = true;
  }
  
  return limited;
};

/**
 * 获取超级管理员授予的模块权限（从组级权限中提取）
 * @param {Array} groupPermissions - 组级权限配置
 * @param {number} moduleId - 模块ID
 * @returns {Object|null} 模块权限配置
 */
export const getSuperAdminModulePermission = (groupPermissions, moduleId) => {
  if (!groupPermissions || !Array.isArray(groupPermissions)) return null;
  
  return groupPermissions.find(p => p.moduleId === moduleId) || null;
};

/**
 * 获取权限上限提示文本
 * @param {string} maxPermission - 最大允许权限
 * @returns {string} 提示文本
 */
export const getPermissionLimitTooltip = (maxPermission) => {
  if (!maxPermission) {
    return '超级管理员未授权此模块';
  }
  
  const permissionNames = {
    [PERMISSION_LEVELS.VIEW_LESSON]: '查看课程',
    [PERMISSION_LEVELS.VIEW_PLAN]: '查看教案',
    [PERMISSION_LEVELS.EDIT]: '编辑'
  };
  
  return `权限上限：${permissionNames[maxPermission]}（超级管理员授权）`;
};

/**
 * 验证权限配置是否合法
 * @param {Object} config - 要验证的权限配置
 * @param {Object} maxConfig - 最大权限配置
 * @returns {{valid: boolean, errors: Array<string>}} 验证结果
 */
export const validatePermissionConfig = (config, maxConfig) => {
  const errors = [];
  
  if (!maxConfig) {
    errors.push('没有上级授权');
    return { valid: false, errors };
  }
  
  // 检查每个模块的权限
  config.modulePermissions?.forEach(modulePerm => {
    const maxModulePerm = maxConfig.modulePermissions?.find(
      m => m.moduleId === modulePerm.moduleId
    );
    
    if (!maxModulePerm) {
      errors.push(`模块 ${modulePerm.moduleName || modulePerm.moduleId} 未被授权`);
      return;
    }
    
    // 检查权限是否超限
    if (modulePerm.edit && !maxModulePerm.edit) {
      errors.push(`模块 ${modulePerm.moduleName} 的编辑权限超出授权范围`);
    }
    
    if (modulePerm.view_plan && !maxModulePerm.view_plan) {
      errors.push(`模块 ${modulePerm.moduleName} 的查看教案权限超出授权范围`);
    }
    
    // 检查课程级权限
    modulePerm.lessons?.forEach(lessonPerm => {
      const maxLessonPerm = maxModulePerm.lessons?.find(
        l => l.lessonId === lessonPerm.lessonId
      );
      
      // 如果没有课程级限制，使用模块级限制
      const effectiveMax = maxLessonPerm || maxModulePerm;
      
      if (lessonPerm.edit && !effectiveMax.edit) {
        errors.push(`课程 ${lessonPerm.lessonTitle} 的编辑权限超出授权范围`);
      }
      
      if (lessonPerm.view_plan && !effectiveMax.view_plan) {
        errors.push(`课程 ${lessonPerm.lessonTitle} 的查看教案权限超出授权范围`);
      }
    });
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * 合并超级管理员权限和组管理员配置
 * @param {Object} superAdminConfig - 超级管理员的授权（只读）
 * @param {Object} groupAdminConfig - 组管理员的配置（可编辑）
 * @returns {Object} 合并后的配置，包含上限信息
 */
export const mergePermissionsWithLimits = (superAdminConfig, groupAdminConfig) => {
  if (!superAdminConfig) return groupAdminConfig;
  
  return {
    ...groupAdminConfig,
    maxPermissions: superAdminConfig.modulePermissions || [],
    modulePermissions: (groupAdminConfig.modulePermissions || []).map(modulePerm => {
      const maxPerm = superAdminConfig.modulePermissions?.find(
        m => m.moduleId === modulePerm.moduleId
      );
      
      return {
        ...modulePerm,
        maxViewLesson: maxPerm?.view_lesson || false,
        maxViewPlan: maxPerm?.view_plan || false,
        maxEdit: maxPerm?.edit || false
      };
    })
  };
};
