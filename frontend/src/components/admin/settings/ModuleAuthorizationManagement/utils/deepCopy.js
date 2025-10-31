/**
 * 深拷贝工具函数
 * 用于复制权限配置，避免引用污染
 * 
 * @module utils/deepCopy
 */

/**
 * 深拷贝权限配置对象
 * 
 * 使用场景：
 * 1. 取消继承时复制上级权限
 * 2. 修改权限时避免直接修改原对象
 * 
 * @param {Array} permissions - 权限配置数组
 * @returns {Array} 深拷贝后的权限配置
 * 
 * @example
 * const copied = deepCopyPermissions([
 *   { moduleId: 1, view_lesson: true, lessons: [...] }
 * ]);
 */
export const deepCopyPermissions = (permissions) => {
  if (!Array.isArray(permissions)) {
    console.warn('deepCopyPermissions: 输入不是数组，返回空数组');
    return [];
  }

  return permissions.map(perm => {
    if (!perm || typeof perm !== 'object') {
      return perm;
    }

    // 拷贝模块级权限
    const copied = {
      ...perm,
      // 深拷贝课程级权限
      lessons: Array.isArray(perm.lessons) 
        ? perm.lessons.map(lesson => ({ ...lesson }))
        : []
    };

    return copied;
  });
};

/**
 * 深拷贝标签配置（包含用户）
 * 
 * @param {Array} tags - 标签配置数组
 * @returns {Array} 深拷贝后的标签配置
 */
export const deepCopyTags = (tags) => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags.map(tag => ({
    ...tag,
    modulePermissions: deepCopyPermissions(tag.modulePermissions || []),
    users: Array.isArray(tag.users)
      ? tag.users.map(user => ({
          ...user,
          modulePermissions: deepCopyPermissions(user.modulePermissions || [])
        }))
      : []
  }));
};

/**
 * 深拷贝完整的授权组配置
 * 
 * @param {Array} groups - 授权组配置数组
 * @returns {Array} 深拷贝后的授权组配置
 */
export const deepCopyGroups = (groups) => {
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups.map(group => ({
    ...group,
    modulePermissions: deepCopyPermissions(group.modulePermissions || []),
    tags: deepCopyTags(group.tags || [])
  }));
};
