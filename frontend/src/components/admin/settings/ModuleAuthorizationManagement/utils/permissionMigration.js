/**
 * 权限数据迁移工具
 * 用于将旧版权限字段迁移到新版三级权限字段
 * 
 * @module utils/permissionMigration
 */

/**
 * 迁移单个权限配置：view → view_lesson
 * 
 * 历史背景：
 * - 旧版：只有 view 和 edit 两种权限
 * - 新版：view_lesson、view_plan、edit 三级权限
 * 
 * @param {Object} perm - 权限配置对象
 * @returns {Object} 迁移后的权限配置
 */
export const migratePermissionData = (perm) => {
  if (!perm || typeof perm !== 'object') {
    return perm;
  }

  const migrated = { ...perm };
  
  // 迁移模块级权限：view → view_lesson
  if (migrated.view !== undefined && migrated.view_lesson === undefined) {
    migrated.view_lesson = migrated.view;
    delete migrated.view;
  }
  
  // 迁移课程级权限
  if (migrated.lessons && Array.isArray(migrated.lessons)) {
    migrated.lessons = migrated.lessons.map(lesson => {
      if (!lesson || typeof lesson !== 'object') {
        return lesson;
      }

      const migratedLesson = { ...lesson };
      
      // view → view_lesson
      if (migratedLesson.view !== undefined && migratedLesson.view_lesson === undefined) {
        migratedLesson.view_lesson = migratedLesson.view;
        delete migratedLesson.view;
      }
      
      return migratedLesson;
    });
  }
  
  return migrated;
};

/**
 * 批量迁移权限配置数组
 * 
 * @param {Array} permissions - 权限配置数组
 * @returns {Array} 迁移后的权限配置数组
 */
export const migratePermissions = (permissions) => {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return permissions.map(migratePermissionData);
};

/**
 * 迁移标签配置（包含用户）
 * 
 * @param {Array} tags - 标签配置数组
 * @returns {Array} 迁移后的标签配置数组
 */
export const migrateTags = (tags) => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags.map(tag => ({
    ...tag,
    modulePermissions: migratePermissions(tag.modulePermissions || []),
    users: Array.isArray(tag.users)
      ? tag.users.map(user => ({
          ...user,
          modulePermissions: migratePermissions(user.modulePermissions || [])
        }))
      : []
  }));
};

/**
 * 迁移完整的授权配置
 * 
 * @param {Object} authConfig - 授权配置对象
 * @returns {Object} 迁移后的授权配置
 */
export const migrateAuthorizationConfig = (authConfig) => {
  if (!authConfig || typeof authConfig !== 'object') {
    return authConfig;
  }

  return {
    ...authConfig,
    modulePermissions: migratePermissions(authConfig.modulePermissions || []),
    tags: migrateTags(authConfig.tags || [])
  };
};
