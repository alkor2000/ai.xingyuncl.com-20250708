/**
 * 全局授权服务（双层配置架构 v4.0.0）
 * 
 * 版本更新：
 * - v4.0.0 (2025-11-09): 完整支持双层配置架构
 *   * 超级管理员配置在superAdminConfig层
 *   * 组管理员配置在groupAdminConfig层
 *   * 自动合并两层配置计算最终权限
 * - v3.0.0 (2025-11-09): 添加组管理员权限边界检查
 * - v2.2.0 (2025-10-31): 三级权限完整返回
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class GlobalAuthorizationService {
  /**
   * 从数据库获取并解析配置（支持双层格式）
   * @private
   */
  static async _getConfig(groupId) {
    try {
      const sql = `
        SELECT config_data 
        FROM teaching_global_authorizations 
        WHERE group_id = ?
      `;

      const { rows } = await dbConnection.query(sql, [groupId]);

      if (rows.length === 0) {
        return null;
      }

      let rawConfig;
      try {
        rawConfig = typeof rows[0].config_data === 'string' 
          ? JSON.parse(rows[0].config_data) 
          : rows[0].config_data;
      } catch (error) {
        logger.error('解析授权配置失败:', error);
        return null;
      }

      // 处理双层配置格式
      if (rawConfig.version === '2.0.0') {
        // 合并superAdminConfig和groupAdminConfig
        const superConfig = rawConfig.superAdminConfig || {};
        const groupConfig = rawConfig.groupAdminConfig || {};
        
        // 合并配置，groupAdminConfig的tags覆盖superAdminConfig的
        return {
          modulePermissions: superConfig.modulePermissions || [],
          tags: groupConfig.tags || [],
          _version: '2.0.0',
          _raw: rawConfig
        };
      } else {
        // 兼容旧格式
        return {
          modulePermissions: rawConfig.modulePermissions || [],
          tags: rawConfig.tags || [],
          _version: '1.0.0',
          _raw: rawConfig
        };
      }
    } catch (error) {
      logger.error('获取配置失败:', error);
      return null;
    }
  }

  /**
   * 获取超级管理员对指定组的授权配置（组管理员用）
   */
  static async getSuperAdminAuthorizationForGroup(groupId) {
    try {
      const config = await this._getConfig(groupId);
      
      if (!config) {
        return null;
      }

      // 如果是双层配置，返回superAdminConfig
      if (config._version === '2.0.0') {
        return config._raw.superAdminConfig || null;
      }

      // 旧格式返回整个配置
      return config;
    } catch (error) {
      logger.error('获取超级管理员授权配置失败:', error);
      return null;
    }
  }

  /**
   * 验证权限配置是否超过上限
   */
  static validatePermissionBoundary(requestedConfig, maxConfig) {
    const errors = [];

    if (!maxConfig) {
      errors.push('没有找到上级授权配置');
      return { valid: false, errors };
    }

    // 获取实际的模块权限列表
    const maxModules = maxConfig.modulePermissions || [];
    const requestedModules = requestedConfig.modulePermissions || [];

    for (const reqModule of requestedModules) {
      const maxModule = maxModules.find(m => m.moduleId === reqModule.moduleId);
      
      if (!maxModule) {
        errors.push(`模块 ${reqModule.moduleName || reqModule.moduleId} 未被超级管理员授权`);
        continue;
      }

      // 检查模块级权限
      if (reqModule.edit && !maxModule.edit) {
        errors.push(`模块 ${reqModule.moduleName} 的编辑权限超出授权范围`);
      }
      if (reqModule.view_plan && !maxModule.view_plan) {
        errors.push(`模块 ${reqModule.moduleName} 的查看教案权限超出授权范围`);
      }
      if (reqModule.view_lesson && !maxModule.view_lesson && !maxModule.view) {
        errors.push(`模块 ${reqModule.moduleName} 的查看课程权限超出授权范围`);
      }

      // 检查课程级权限
      const reqLessons = reqModule.lessons || [];
      for (const reqLesson of reqLessons) {
        const maxLesson = maxModule.lessons?.find(l => l.lessonId === reqLesson.lessonId);
        const effectiveMax = maxLesson || maxModule;

        if (reqLesson.edit && !effectiveMax.edit) {
          errors.push(`课程 ${reqLesson.lessonTitle} 的编辑权限超出授权范围`);
        }
        if (reqLesson.view_plan && !effectiveMax.view_plan) {
          errors.push(`课程 ${reqLesson.lessonTitle} 的查看教案权限超出授权范围`);
        }
        if (reqLesson.view_lesson && !effectiveMax.view_lesson && !effectiveMax.view) {
          errors.push(`课程 ${reqLesson.lessonTitle} 的查看课程权限超出授权范围`);
        }
      }
    }

    // 递归验证标签权限
    if (requestedConfig.tags) {
      for (const reqTag of requestedConfig.tags) {
        if (!reqTag.inheritFromGroup) {
          const tagValidation = this.validatePermissionBoundary(
            { modulePermissions: reqTag.modulePermissions },
            maxConfig
          );
          if (!tagValidation.valid) {
            errors.push(`标签 ${reqTag.tagName}: ${tagValidation.errors.join(', ')}`);
          }
        }

        // 验证用户权限
        if (reqTag.users) {
          for (const reqUser of reqTag.users) {
            if (!reqUser.inheritFromTag) {
              const userValidation = this.validatePermissionBoundary(
                { modulePermissions: reqUser.modulePermissions },
                maxConfig
              );
              if (!userValidation.valid) {
                errors.push(`用户 ${reqUser.username}: ${userValidation.errors.join(', ')}`);
              }
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取用户对模块的权限（三级权限完整返回，支持双层配置）
   */
  static async getUserModulePermission(userId, moduleId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return { hasViewLesson: false, hasViewPlan: false, hasEdit: false };
      }

      const config = await this._getConfig(userGroupId);

      if (!config) {
        return { hasViewLesson: false, hasViewPlan: false, hasEdit: false };
      }

      // 1. 组级权限（来自superAdminConfig的modulePermissions）
      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      
      let groupHasViewLesson = groupModulePerm?.view_lesson || groupModulePerm?.view || false;
      let groupHasViewPlan = groupModulePerm?.view_plan || false;
      let groupHasEdit = groupModulePerm?.edit || false;
      
      // 如果有课程权限，也算有查看课程权限
      if (!groupHasViewLesson && this._hasAnyLessonPermission(groupModulePerm)) {
        groupHasViewLesson = true;
      }

      let hasViewLesson = false;
      let hasViewPlan = false;
      let hasEdit = false;

      // 2. 处理标签和用户权限（来自groupAdminConfig的tags）
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
              hasViewLesson = groupHasViewLesson;
              hasViewPlan = groupHasViewPlan;
              hasEdit = groupHasEdit;
            } else {
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              if (tagModulePerm) {
                hasViewLesson = tagModulePerm.view_lesson || tagModulePerm.view || false;
                hasViewPlan = tagModulePerm.view_plan || false;
                hasEdit = tagModulePerm.edit || false;
                
                if (!hasViewLesson && this._hasAnyLessonPermission(tagModulePerm)) {
                  hasViewLesson = true;
                }
              } else {
                hasViewLesson = false;
                hasViewPlan = false;
                hasEdit = false;
              }
            }
          } else {
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            if (userModulePerm) {
              hasViewLesson = userModulePerm.view_lesson || userModulePerm.view || false;
              hasViewPlan = userModulePerm.view_plan || false;
              hasEdit = userModulePerm.edit || false;
              
              if (!hasViewLesson && this._hasAnyLessonPermission(userModulePerm)) {
                hasViewLesson = true;
              }
            } else {
              hasViewLesson = false;
              hasViewPlan = false;
              hasEdit = false;
            }
          }
        } else {
          if (tag.inheritFromGroup) {
            hasViewLesson = groupHasViewLesson;
            hasViewPlan = groupHasViewPlan;
            hasEdit = groupHasEdit;
          } else {
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            if (tagModulePerm) {
              hasViewLesson = tagModulePerm.view_lesson || tagModulePerm.view || false;
              hasViewPlan = tagModulePerm.view_plan || false;
              hasEdit = tagModulePerm.edit || false;
              
              if (!hasViewLesson && this._hasAnyLessonPermission(tagModulePerm)) {
                hasViewLesson = true;
              }
            } else {
              hasViewLesson = false;
              hasViewPlan = false;
              hasEdit = false;
            }
          }
        }
        
        break;
      }

      // 如果用户没有标签，使用组权限
      if (userTagIds.length === 0) {
        hasViewLesson = groupHasViewLesson;
        hasViewPlan = groupHasViewPlan;
        hasEdit = groupHasEdit;
      }

      logger.info('用户模块权限（双层配置）', {
        userId,
        moduleId,
        configVersion: config._version,
        hasViewLesson,
        hasViewPlan,
        hasEdit
      });

      return { hasViewLesson, hasViewPlan, hasEdit };
    } catch (error) {
      logger.error('获取用户模块权限失败:', error);
      return { hasViewLesson: false, hasViewPlan: false, hasEdit: false };
    }
  }

  /**
   * 获取用户对课程的权限（三级权限完整返回，支持双层配置）
   */
  static async getUserLessonPermission(userId, moduleId, lessonId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return { hasViewLesson: false, hasViewPlan: false, hasEdit: false };
      }

      const config = await this._getConfig(userGroupId);

      if (!config) {
        return { hasViewLesson: false, hasViewPlan: false, hasEdit: false };
      }

      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      const groupLessonPerm = this._findLessonPermission(groupModulePerm?.lessons || [], lessonId);

      let groupHasViewLesson, groupHasViewPlan, groupHasEdit;
      if (groupLessonPerm) {
        groupHasViewLesson = groupLessonPerm.view_lesson || groupLessonPerm.view || false;
        groupHasViewPlan = groupLessonPerm.view_plan || false;
        groupHasEdit = groupLessonPerm.edit || false;
      } else {
        groupHasViewLesson = groupModulePerm?.view_lesson || groupModulePerm?.view || false;
        groupHasViewPlan = groupModulePerm?.view_plan || false;
        groupHasEdit = groupModulePerm?.edit || false;
      }

      let hasViewLesson = false;
      let hasViewPlan = false;
      let hasEdit = false;

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
              hasViewLesson = groupHasViewLesson;
              hasViewPlan = groupHasViewPlan;
              hasEdit = groupHasEdit;
            } else {
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              const tagLessonPerm = this._findLessonPermission(tagModulePerm?.lessons || [], lessonId);
              
              if (tagLessonPerm) {
                hasViewLesson = tagLessonPerm.view_lesson || tagLessonPerm.view || false;
                hasViewPlan = tagLessonPerm.view_plan || false;
                hasEdit = tagLessonPerm.edit || false;
              } else {
                hasViewLesson = tagModulePerm?.view_lesson || tagModulePerm?.view || false;
                hasViewPlan = tagModulePerm?.view_plan || false;
                hasEdit = tagModulePerm?.edit || false;
              }
            }
          } else {
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            const userLessonPerm = this._findLessonPermission(userModulePerm?.lessons || [], lessonId);
            
            if (userLessonPerm) {
              hasViewLesson = userLessonPerm.view_lesson || userLessonPerm.view || false;
              hasViewPlan = userLessonPerm.view_plan || false;
              hasEdit = userLessonPerm.edit || false;
            } else {
              hasViewLesson = userModulePerm?.view_lesson || userModulePerm?.view || false;
              hasViewPlan = userModulePerm?.view_plan || false;
              hasEdit = userModulePerm?.edit || false;
            }
          }
        } else {
          if (tag.inheritFromGroup) {
            hasViewLesson = groupHasViewLesson;
            hasViewPlan = groupHasViewPlan;
            hasEdit = groupHasEdit;
          } else {
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            const tagLessonPerm = this._findLessonPermission(tagModulePerm?.lessons || [], lessonId);
            
            if (tagLessonPerm) {
              hasViewLesson = tagLessonPerm.view_lesson || tagLessonPerm.view || false;
              hasViewPlan = tagLessonPerm.view_plan || false;
              hasEdit = tagLessonPerm.edit || false;
            } else {
              hasViewLesson = tagModulePerm?.view_lesson || tagModulePerm?.view || false;
              hasViewPlan = tagModulePerm?.view_plan || false;
              hasEdit = tagModulePerm?.edit || false;
            }
          }
        }
        
        break;
      }

      if (userTagIds.length === 0) {
        hasViewLesson = groupHasViewLesson;
        hasViewPlan = groupHasViewPlan;
        hasEdit = groupHasEdit;
      }

      logger.info('用户课程权限（双层配置）', {
        userId,
        moduleId,
        lessonId,
        configVersion: config._version,
        hasViewLesson,
        hasViewPlan,
        hasEdit
      });

      return { hasViewLesson, hasViewPlan, hasEdit };
    } catch (error) {
      logger.error('获取用户课程权限失败:', error);
      return { hasViewLesson: false, hasViewPlan: false, hasEdit: false };
    }
  }

  /**
   * 获取用户有权限访问的所有模块ID列表（支持双层配置）
   */
  static async getUserAuthorizedModuleIds(userId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return [];
      }

      const config = await this._getConfig(userGroupId);

      if (!config) {
        return [];
      }

      const moduleIds = new Set();

      // 从superAdminConfig层获取组权限
      const groupPerms = config.modulePermissions || [];
      const groupModuleIds = new Set();
      groupPerms.forEach(perm => {
        if (perm.view_lesson || perm.view_plan || perm.edit || perm.view || this._hasAnyLessonPermission(perm)) {
          groupModuleIds.add(perm.moduleId);
        }
      });

      // 从groupAdminConfig层获取标签和用户权限
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
              groupModuleIds.forEach(id => moduleIds.add(id));
            } else {
              const tagPerms = tag.modulePermissions || [];
              tagPerms.forEach(perm => {
                if (perm.view_lesson || perm.view_plan || perm.edit || perm.view || this._hasAnyLessonPermission(perm)) {
                  moduleIds.add(perm.moduleId);
                }
              });
            }
          } else {
            const userPerms = userConfig.modulePermissions || [];
            userPerms.forEach(perm => {
              if (perm.view_lesson || perm.view_plan || perm.edit || perm.view || this._hasAnyLessonPermission(perm)) {
                moduleIds.add(perm.moduleId);
              }
            });
          }
        } else {
          if (tag.inheritFromGroup) {
            groupModuleIds.forEach(id => moduleIds.add(id));
          } else {
            const tagPerms = tag.modulePermissions || [];
            tagPerms.forEach(perm => {
              if (perm.view_lesson || perm.view_plan || perm.edit || perm.view || this._hasAnyLessonPermission(perm)) {
                moduleIds.add(perm.moduleId);
              }
            });
          }
        }
        
        break;
      }

      if (userTagIds.length === 0 && !foundUserConfig) {
        groupModuleIds.forEach(id => moduleIds.add(id));
      }

      const result = Array.from(moduleIds);
      
      logger.info('用户授权模块列表（双层配置）', {
        userId,
        userGroupId,
        configVersion: config._version,
        totalModules: result.length
      });

      return result;
    } catch (error) {
      logger.error('获取用户授权模块ID失败:', error);
      return [];
    }
  }

  /**
   * 获取用户授权的课程ID（支持双层配置）
   */
  static async getUserAuthorizedLessonIds(userId, moduleId, userGroupId, userTags = []) {
    try {
      if (!userGroupId) {
        return null;
      }

      const config = await this._getConfig(userGroupId);

      if (!config) {
        return null;
      }

      // 从superAdminConfig层获取组级模块权限
      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      
      if (!groupModulePerm) {
        return null;
      }

      // 检查模块级别是否有权限
      const moduleHasPermission = groupModulePerm.view_lesson || 
                                  groupModulePerm.view_plan || 
                                  groupModulePerm.edit || 
                                  groupModulePerm.view || false;

      // 如果模块级别有权限且没有课程级别的限制
      if (moduleHasPermission && (!groupModulePerm.lessons || groupModulePerm.lessons.length === 0)) {
        return null; // 返回null表示所有课程都有权限
      }

      // 从标签和用户级别获取权限
      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);
      
      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);
        
        let effectiveModulePerm = null;
        
        if (userConfig) {
          if (userConfig.inheritFromTag) {
            if (tag.inheritFromGroup) {
              effectiveModulePerm = groupModulePerm;
            } else {
              effectiveModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            }
          } else {
            effectiveModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
          }
        } else {
          if (tag.inheritFromGroup) {
            effectiveModulePerm = groupModulePerm;
          } else {
            effectiveModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
          }
        }

        if (effectiveModulePerm) {
          const lessonConfig = effectiveModulePerm.lessonConfig;
          
          // 处理"全部启用除了"模式
          if (lessonConfig?.mode === 'all_except') {
            return {
              mode: 'all_except',
              deniedLessonIds: lessonConfig.deniedLessonIds || []
            };
          }
          
          // 处理课程级别权限
          if (effectiveModulePerm.lessons && effectiveModulePerm.lessons.length > 0) {
            const authorizedLessonIds = [];
            effectiveModulePerm.lessons.forEach(lesson => {
              if (lesson.view_lesson || lesson.view_plan || lesson.edit || lesson.view) {
                authorizedLessonIds.push(lesson.lessonId);
              }
            });
            return authorizedLessonIds;
          }
          
          // 如果没有课程级别限制，返回null表示所有课程都有权限
          return null;
        }
        
        break;
      }

      // 默认使用组权限
      if (userTagIds.length === 0) {
        if (moduleHasPermission) {
          if (groupModulePerm.lessons && groupModulePerm.lessons.length > 0) {
            const authorizedLessonIds = [];
            groupModulePerm.lessons.forEach(lesson => {
              if (lesson.view_lesson || lesson.view_plan || lesson.edit || lesson.view) {
                authorizedLessonIds.push(lesson.lessonId);
              }
            });
            return authorizedLessonIds;
          }
          return null;
        }
      }

      return [];
    } catch (error) {
      logger.error('获取用户授权课程ID失败:', error);
      return [];
    }
  }

  // ==================== 辅助方法 ====================
  
  static _hasAnyLessonPermission(modulePerm) {
    if (!modulePerm || !modulePerm.lessons) {
      return false;
    }
    return modulePerm.lessons.some(lesson => 
      lesson.view_lesson === true || 
      lesson.view_plan === true || 
      lesson.edit === true || 
      lesson.view === true
    );
  }

  static _findModulePermission(permissions, moduleId) {
    return permissions.find(p => p.moduleId === parseInt(moduleId));
  }

  static _findLessonPermission(lessons, lessonId) {
    return lessons.find(l => l.lessonId === parseInt(lessonId));
  }

  static async hasAnyModulePermission(userId, moduleId, userGroupId, userTags = []) {
    const perm = await this.getUserModulePermission(userId, moduleId, userGroupId, userTags);
    return perm.hasViewLesson || perm.hasViewPlan || perm.hasEdit;
  }

  static async hasAnyLessonPermission(userId, moduleId, lessonId, userGroupId, userTags = []) {
    const perm = await this.getUserLessonPermission(userId, moduleId, lessonId, userGroupId, userTags);
    return perm.hasViewLesson || perm.hasViewPlan || perm.hasEdit;
  }

  /**
   * 保存授权配置（带权限边界检查，支持双层配置）
   * @deprecated 请使用TeachingController中的saveGlobalAuthorizations方法
   */
  static async saveAuthorizationWithBoundaryCheck(config, groupId, userId, userRole) {
    logger.warn('saveAuthorizationWithBoundaryCheck方法已弃用，请使用TeachingController中的方法');
    return { success: false, error: '此方法已弃用' };
  }
}

module.exports = GlobalAuthorizationService;
