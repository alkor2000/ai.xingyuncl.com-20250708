/**
 * 全局授权服务（继承链修复版）
 * 
 * 核心修复：
 * - 正确处理用户→标签→组的完整继承链
 * - inheritFromTag 时继续检查标签的 inheritFromGroup
 * - 修复继承逻辑断裂问题
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class GlobalAuthorizationService {
  /**
   * 获取用户对模块的权限（修复：完整继承链）
   */
  static async getUserModulePermission(userId, moduleId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return { hasView: false, hasEdit: false };
      }

      const sql = `
        SELECT config_data 
        FROM teaching_global_authorizations 
        WHERE group_id = ?
      `;

      const { rows } = await dbConnection.query(sql, [userGroupId]);

      if (rows.length === 0) {
        return { hasView: false, hasEdit: false };
      }

      let config;
      try {
        config = typeof rows[0].config_data === 'string' 
          ? JSON.parse(rows[0].config_data) 
          : rows[0].config_data;
      } catch (error) {
        logger.error('解析授权配置失败:', error);
        return { hasView: false, hasEdit: false };
      }

      // 1. 组级权限（基础权限）
      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      let hasView = false;
      let hasEdit = false;
      
      // 记录组级权限，供继承使用
      const groupView = groupModulePerm?.view || this._hasAnyLessonPermission(groupModulePerm) || false;
      const groupEdit = groupModulePerm?.edit || false;

      // 2. 处理标签和用户权限
      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);
      
      // 查找用户的标签配置
      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        // 查找用户配置
        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);
        
        // 判断最终权限来源
        if (userConfig) {
          // 用户存在配置
          if (userConfig.inheritFromTag) {
            // 用户继承标签权限
            if (tag.inheritFromGroup) {
              // 标签继承组权限，使用组级权限
              hasView = groupView;
              hasEdit = groupEdit;
              
              logger.info('用户继承标签，标签继承组（使用组权限）', {
                userId,
                moduleId,
                tagId: tag.tagId,
                groupView,
                groupEdit,
                hasView,
                hasEdit
              });
            } else {
              // 标签有自己的权限配置
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              if (tagModulePerm) {
                const tagHasAnyLessonPerm = this._hasAnyLessonPermission(tagModulePerm);
                hasView = tagModulePerm.view || tagHasAnyLessonPerm || false;
                hasEdit = tagModulePerm.edit || false;
              } else {
                // 标签没有此模块的权限
                hasView = false;
                hasEdit = false;
              }
              
              logger.info('用户继承标签权限', {
                userId,
                moduleId,
                tagId: tag.tagId,
                hasView,
                hasEdit
              });
            }
          } else {
            // 用户不继承标签，使用自己的权限配置
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            if (userModulePerm) {
              const userHasAnyLessonPerm = this._hasAnyLessonPermission(userModulePerm);
              hasView = userModulePerm.view || userHasAnyLessonPerm || false;
              hasEdit = userModulePerm.edit || false;
              
              logger.info('用户使用自定义权限', {
                userId,
                moduleId,
                hasView,
                hasEdit
              });
            } else {
              // 用户没有此模块的配置，无权限
              hasView = false;
              hasEdit = false;
              
              logger.info('用户无此模块权限配置', {
                userId,
                moduleId
              });
            }
          }
        } else {
          // 用户没有特殊配置，检查标签权限
          if (tag.inheritFromGroup) {
            // 标签继承组权限
            hasView = groupView;
            hasEdit = groupEdit;
            
            logger.info('用户无配置，标签继承组权限', {
              userId,
              moduleId,
              tagId: tag.tagId,
              hasView,
              hasEdit
            });
          } else {
            // 使用标签自己的权限
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            if (tagModulePerm) {
              const tagHasAnyLessonPerm = this._hasAnyLessonPermission(tagModulePerm);
              hasView = tagModulePerm.view || tagHasAnyLessonPerm || false;
              hasEdit = tagModulePerm.edit || false;
            } else {
              hasView = false;
              hasEdit = false;
            }
            
            logger.info('用户无配置，使用标签权限', {
              userId,
              moduleId,
              tagId: tag.tagId,
              hasView,
              hasEdit
            });
          }
        }
        
        // 找到第一个匹配的标签就返回
        break;
      }

      // 如果用户没有任何标签，使用组权限
      if (userTagIds.length === 0) {
        hasView = groupView;
        hasEdit = groupEdit;
        
        logger.info('用户无标签，使用组权限', {
          userId,
          moduleId,
          hasView,
          hasEdit
        });
      }

      return { hasView, hasEdit };
    } catch (error) {
      logger.error('获取用户模块权限失败:', error);
      return { hasView: false, hasEdit: false };
    }
  }

  /**
   * 获取用户对课程的权限（修复：完整继承链）
   */
  static async getUserLessonPermission(userId, moduleId, lessonId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return { hasView: false, hasEdit: false };
      }

      const sql = `
        SELECT config_data 
        FROM teaching_global_authorizations 
        WHERE group_id = ?
      `;

      const { rows } = await dbConnection.query(sql, [userGroupId]);

      if (rows.length === 0) {
        return { hasView: false, hasEdit: false };
      }

      let config;
      try {
        config = typeof rows[0].config_data === 'string' 
          ? JSON.parse(rows[0].config_data) 
          : rows[0].config_data;
      } catch (error) {
        logger.error('解析授权配置失败:', error);
        return { hasView: false, hasEdit: false };
      }

      // 1. 组级权限
      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      const groupLessonPerm = this._findLessonPermission(groupModulePerm?.lessons || [], lessonId);

      const groupView = groupLessonPerm?.view || groupModulePerm?.view || false;
      const groupEdit = groupLessonPerm?.edit || groupModulePerm?.edit || false;

      let hasView = false;
      let hasEdit = false;

      // 2. 处理标签和用户权限
      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);

      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);

        if (userConfig) {
          if (userConfig.inheritFromTag) {
            if (tag.inheritFromGroup) {
              hasView = groupView;
              hasEdit = groupEdit;
            } else {
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              const tagLessonPerm = this._findLessonPermission(tagModulePerm?.lessons || [], lessonId);
              hasView = tagLessonPerm?.view || tagModulePerm?.view || false;
              hasEdit = tagLessonPerm?.edit || tagModulePerm?.edit || false;
            }
          } else {
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            const userLessonPerm = this._findLessonPermission(userModulePerm?.lessons || [], lessonId);
            hasView = userLessonPerm?.view || userModulePerm?.view || false;
            hasEdit = userLessonPerm?.edit || userModulePerm?.edit || false;
          }
        } else {
          if (tag.inheritFromGroup) {
            hasView = groupView;
            hasEdit = groupEdit;
          } else {
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            const tagLessonPerm = this._findLessonPermission(tagModulePerm?.lessons || [], lessonId);
            hasView = tagLessonPerm?.view || tagModulePerm?.view || false;
            hasEdit = tagLessonPerm?.edit || tagModulePerm?.edit || false;
          }
        }
        
        break;
      }

      if (userTagIds.length === 0) {
        hasView = groupView;
        hasEdit = groupEdit;
      }

      return { hasView, hasEdit };
    } catch (error) {
      logger.error('获取用户课程权限失败:', error);
      return { hasView: false, hasEdit: false };
    }
  }

  /**
   * 获取用户有权限访问的所有模块ID列表（修复：完整继承链）
   */
  static async getUserAuthorizedModuleIds(userId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return [];
      }

      const sql = `
        SELECT config_data 
        FROM teaching_global_authorizations 
        WHERE group_id = ?
      `;

      const { rows } = await dbConnection.query(sql, [userGroupId]);

      if (rows.length === 0) {
        return [];
      }

      let config;
      try {
        config = typeof rows[0].config_data === 'string' 
          ? JSON.parse(rows[0].config_data) 
          : rows[0].config_data;
      } catch (error) {
        logger.error('解析授权配置失败:', error);
        return [];
      }

      const moduleIds = new Set();

      // 1. 收集组级权限的模块
      const groupPerms = config.modulePermissions || [];
      const groupModuleIds = new Set();
      groupPerms.forEach(perm => {
        if (perm.view || perm.edit || this._hasAnyLessonPermission(perm)) {
          groupModuleIds.add(perm.moduleId);
        }
      });

      // 2. 根据用户标签确定最终权限
      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);
      
      let foundUserConfig = false;

      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);

        if (userConfig) {
          foundUserConfig = true;
          
          if (userConfig.inheritFromTag) {
            if (tag.inheritFromGroup) {
              // 继承组权限
              groupModuleIds.forEach(id => moduleIds.add(id));
            } else {
              // 继承标签权限
              const tagPerms = tag.modulePermissions || [];
              tagPerms.forEach(perm => {
                if (perm.view || perm.edit || this._hasAnyLessonPermission(perm)) {
                  moduleIds.add(perm.moduleId);
                }
              });
            }
          } else {
            // 使用用户自定义权限
            const userPerms = userConfig.modulePermissions || [];
            userPerms.forEach(perm => {
              if (perm.view || perm.edit || this._hasAnyLessonPermission(perm)) {
                moduleIds.add(perm.moduleId);
              }
            });
          }
        } else {
          if (tag.inheritFromGroup) {
            // 标签继承组，用户继承标签
            groupModuleIds.forEach(id => moduleIds.add(id));
          } else {
            // 使用标签权限
            const tagPerms = tag.modulePermissions || [];
            tagPerms.forEach(perm => {
              if (perm.view || perm.edit || this._hasAnyLessonPermission(perm)) {
                moduleIds.add(perm.moduleId);
              }
            });
          }
        }
        
        break;
      }

      // 如果用户没有标签，使用组权限
      if (userTagIds.length === 0 && !foundUserConfig) {
        groupModuleIds.forEach(id => moduleIds.add(id));
      }

      const result = Array.from(moduleIds);
      
      logger.info('用户授权模块列表', {
        userId,
        userGroupId,
        totalModules: result.length,
        moduleIds: result,
        userTags: userTags.map(t => ({ id: t.id, name: t.name }))
      });

      return result;
    } catch (error) {
      logger.error('获取用户授权模块ID失败:', error);
      return [];
    }
  }

  /**
   * 获取用户对指定模块有权限的课程ID列表
   */
  static async getUserAuthorizedLessonIds(userId, moduleId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return [];
      }

      const sql = `
        SELECT config_data 
        FROM teaching_global_authorizations 
        WHERE group_id = ?
      `;

      const { rows } = await dbConnection.query(sql, [userGroupId]);

      if (rows.length === 0) {
        return [];
      }

      let config;
      try {
        config = typeof rows[0].config_data === 'string' 
          ? JSON.parse(rows[0].config_data) 
          : rows[0].config_data;
      } catch (error) {
        logger.error('解析授权配置失败:', error);
        return [];
      }

      let hasModulePermission = false;
      const lessonIds = new Set();

      // 1. 组级权限
      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      const groupHasModulePermission = groupModulePerm?.view || groupModulePerm?.edit || false;
      const groupLessonIds = new Set();
      
      if (groupModulePerm) {
        (groupModulePerm.lessons || []).forEach(lesson => {
          if (lesson.view || lesson.edit) {
            groupLessonIds.add(lesson.lessonId);
          }
        });
      }

      // 2. 标签和用户权限
      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);

      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);

        if (userConfig) {
          if (userConfig.inheritFromTag) {
            if (tag.inheritFromGroup) {
              hasModulePermission = groupHasModulePermission;
              groupLessonIds.forEach(id => lessonIds.add(id));
            } else {
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              if (tagModulePerm) {
                hasModulePermission = tagModulePerm.view || tagModulePerm.edit || false;
                (tagModulePerm.lessons || []).forEach(lesson => {
                  if (lesson.view || lesson.edit) {
                    lessonIds.add(lesson.lessonId);
                  }
                });
              }
            }
          } else {
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            if (userModulePerm) {
              hasModulePermission = userModulePerm.view || userModulePerm.edit || false;
              (userModulePerm.lessons || []).forEach(lesson => {
                if (lesson.view || lesson.edit) {
                  lessonIds.add(lesson.lessonId);
                }
              });
            }
          }
        } else {
          if (tag.inheritFromGroup) {
            hasModulePermission = groupHasModulePermission;
            groupLessonIds.forEach(id => lessonIds.add(id));
          } else {
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            if (tagModulePerm) {
              hasModulePermission = tagModulePerm.view || tagModulePerm.edit || false;
              (tagModulePerm.lessons || []).forEach(lesson => {
                if (lesson.view || lesson.edit) {
                  lessonIds.add(lesson.lessonId);
                }
              });
            }
          }
        }
        
        break;
      }

      if (userTagIds.length === 0) {
        hasModulePermission = groupHasModulePermission;
        groupLessonIds.forEach(id => lessonIds.add(id));
      }

      // 如果有模块权限，返回 null 表示所有课程可见
      if (hasModulePermission) {
        return null;
      }

      // 返回明确授权的课程ID列表
      return Array.from(lessonIds);
    } catch (error) {
      logger.error('获取用户授权课程ID失败:', error);
      return [];
    }
  }

  /**
   * 辅助方法：检查模块权限中是否有任何课程权限
   */
  static _hasAnyLessonPermission(modulePerm) {
    if (!modulePerm || !modulePerm.lessons) {
      return false;
    }
    return modulePerm.lessons.some(lesson => lesson.view || lesson.edit);
  }

  /**
   * 辅助方法：从权限列表中查找指定模块的权限
   */
  static _findModulePermission(permissions, moduleId) {
    return permissions.find(p => p.moduleId === parseInt(moduleId));
  }

  /**
   * 辅助方法：从课程权限列表中查找指定课程的权限
   */
  static _findLessonPermission(lessons, lessonId) {
    return lessons.find(l => l.lessonId === parseInt(lessonId));
  }

  /**
   * 检查用户是否有模块的任意权限
   */
  static async hasAnyModulePermission(userId, moduleId, userGroupId, userTags = []) {
    const perm = await this.getUserModulePermission(userId, moduleId, userGroupId, userTags);
    return perm.hasView || perm.hasEdit;
  }

  /**
   * 检查用户是否有课程的任意权限
   */
  static async hasAnyLessonPermission(userId, moduleId, lessonId, userGroupId, userTags = []) {
    const perm = await this.getUserLessonPermission(userId, moduleId, lessonId, userGroupId, userTags);
    return perm.hasView || perm.hasEdit;
  }
}

module.exports = GlobalAuthorizationService;
