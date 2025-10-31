/**
 * 权限计算工具
 * 用于计算实际权限、处理级联逻辑
 * 
 * @module utils/permissionCalculator
 */

import { 
  PERMISSION_LEVELS, 
  PERMISSION_CASCADE_GRANT, 
  PERMISSION_CASCADE_REVOKE 
} from '../constants/permissionTypes';

/**
 * 计算授予权限时需要级联授予的下级权限
 * 
 * 规则：
 * - 授予 edit → 自动授予 view_plan, view_lesson
 * - 授予 view_plan → 自动授予 view_lesson
 * - 授予 view_lesson → 无级联
 * 
 * @param {string} permType - 权限类型
 * @returns {Object} 需要设置的权限对象
 */
export const calculateGrantPermissions = (permType) => {
  const permissions = {};
  
  // 设置当前权限
  permissions[permType] = true;
  
  // 级联授予下级权限
  const cascadePerms = PERMISSION_CASCADE_GRANT[permType] || [];
  cascadePerms.forEach(perm => {
    permissions[perm] = true;
  });
  
  return permissions;
};

/**
 * 计算撤销权限时需要级联撤销的上级权限
 * 
 * 规则：
 * - 撤销 view_lesson → 自动撤销 view_plan, edit
 * - 撤销 view_plan → 自动撤销 edit
 * - 撤销 edit → 无级联
 * 
 * @param {string} permType - 权限类型
 * @returns {Array<string>} 需要撤销的权限列表
 */
export const calculateRevokePermissions = (permType) => {
  const permissions = [permType];
  
  // 级联撤销上级权限
  const cascadePerms = PERMISSION_CASCADE_REVOKE[permType] || [];
  permissions.push(...cascadePerms);
  
  return permissions;
};

/**
 * 判断权限是否被其他权限禁用
 * 
 * 场景：
 * - 如果已有 view_plan，则 view_lesson 复选框应禁用
 * - 如果已有 edit，则 view_plan 和 view_lesson 复选框应禁用
 * 
 * @param {string} permType - 当前权限类型
 * @param {Object} currentPerms - 当前已有的权限
 * @returns {boolean} 是否应该禁用
 */
export const isPermissionDisabled = (permType, currentPerms) => {
  if (!currentPerms) return false;
  
  // 如果有更高级权限，则禁用当前权限
  const higherPerms = PERMISSION_CASCADE_REVOKE[permType] || [];
  return higherPerms.some(perm => currentPerms[perm] === true);
};

/**
 * 合并权限配置（处理继承）
 * 
 * 优先级：用户独立配置 > 标签权限 > 组权限
 * 
 * @param {Object} userPerm - 用户权限
 * @param {Object} tagPerm - 标签权限
 * @param {Object} groupPerm - 组权限
 * @param {boolean} userInheritsTag - 用户是否继承标签
 * @param {boolean} tagInheritsGroup - 标签是否继承组
 * @returns {Object} 实际生效的权限
 */
export const calculateEffectivePermission = (
  userPerm, 
  tagPerm, 
  groupPerm, 
  userInheritsTag = true, 
  tagInheritsGroup = true
) => {
  // 用户有独立配置
  if (userPerm && !userInheritsTag) {
    return userPerm;
  }
  
  // 用户继承标签
  if (userInheritsTag) {
    // 标签有独立配置
    if (tagPerm && !tagInheritsGroup) {
      return tagPerm;
    }
    
    // 标签继承组
    if (tagInheritsGroup) {
      return groupPerm;
    }
  }
  
  // 默认返回组权限
  return groupPerm;
};

/**
 * 检查权限配置是否为空
 * 
 * @param {Object} perm - 权限配置
 * @returns {boolean} 是否为空
 */
export const isPermissionEmpty = (perm) => {
  if (!perm) return true;
  
  const { view_lesson, view_plan, edit } = perm;
  return !view_lesson && !view_plan && !edit;
};

/**
 * 获取权限的最高级别
 * 
 * @param {Object} perm - 权限配置
 * @returns {string|null} 最高权限类型
 */
export const getHighestPermission = (perm) => {
  if (!perm) return null;
  
  if (perm.edit) return PERMISSION_LEVELS.EDIT;
  if (perm.view_plan) return PERMISSION_LEVELS.VIEW_PLAN;
  if (perm.view_lesson) return PERMISSION_LEVELS.VIEW_LESSON;
  
  return null;
};

/**
 * 比较两个权限配置是否相同
 * 
 * @param {Object} perm1 - 权限配置1
 * @param {Object} perm2 - 权限配置2
 * @returns {boolean} 是否相同
 */
export const arePermissionsEqual = (perm1, perm2) => {
  if (!perm1 && !perm2) return true;
  if (!perm1 || !perm2) return false;
  
  return (
    perm1.view_lesson === perm2.view_lesson &&
    perm1.view_plan === perm2.view_plan &&
    perm1.edit === perm2.edit
  );
};
