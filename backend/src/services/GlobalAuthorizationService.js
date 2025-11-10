/**
 * 全局授权服务（双层配置架构 v4.2.0 - 多标签权限合并）
 * 
 * 版本更新：
 * - v4.2.0 (2025-11-11): 修复多标签权限合并bug
 *   * 修复只取第一个标签的问题
 *   * 合并所有标签的权限（取最大权限）
 *   * 正确处理用户拥有多个标签的场景
 * 
 * - v4.1.0 (2025-11-11): 添加自动版本迁移功能
 * - v4.0.0 (2025-11-09): 完整支持双层配置架构
 * - v3.0.0 (2025-11-09): 添加组管理员权限边界检查
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class GlobalAuthorizationService {
  /**
   * 从数据库获取并解析配置（支持双层格式 + 自动迁移）
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

      // 自动版本迁移
      if (!rawConfig.version || rawConfig.version !== '2.0.0') {
        logger.info('检测到旧版本配置，开始自动迁移', {
          groupId,
          oldVersion: rawConfig.version || '1.0.0'
        });
        
        rawConfig = await this._migrateToV2(groupId, rawConfig);
      }

      // 处理双层配置格式
      if (rawConfig.version === '2.0.0') {
        const superConfig = rawConfig.superAdminConfig || {};
        const groupConfig = rawConfig.groupAdminConfig || {};
        
        return {
          modulePermissions: superConfig.modulePermissions || [],
          tags: groupConfig.tags || [],
          _version: '2.0.0',
          _raw: rawConfig
        };
      }

      return {
        modulePermissions: rawConfig.modulePermissions || [],
        tags: rawConfig.tags || [],
        _version: '1.0.0',
        _raw: rawConfig
      };
    } catch (error) {
      logger.error('获取配置失败:', error);
      return null;
    }
  }

  static async _migrateToV2(groupId, oldConfig) {
    const now = new Date().toISOString();
    
    const newConfig = {
      version: '2.0.0',
      migratedAt: now,
      lastUpdatedAt: now,
      lastUpdatedBy: oldConfig.updatedBy || oldConfig.createdBy || 0,
      superAdminConfig: {
        note: '超级管理员授权配置',
        modulePermissions: oldConfig.modulePermissions || [],
        createdAt: oldConfig.createdAt || now,
        createdBy: oldConfig.createdBy || 0,
        updatedAt: now,
        updatedBy: oldConfig.updatedBy || oldConfig.createdBy || 0
      },
      groupAdminConfig: {
        note: '组管理员分配配置',
        tags: oldConfig.tags || [],
        updatedAt: now,
        updatedBy: oldConfig.updatedBy || oldConfig.createdBy || 0
      }
    };

    try {
      await this._saveConfig(groupId, newConfig);
      logger.info('配置迁移成功并已保存', {
        groupId,
        fromVersion: oldConfig.version || '1.0.0',
        toVersion: '2.0.0'
      });
    } catch (error) {
      logger.error('保存迁移后的配置失败:', error);
    }

    return newConfig;
  }

  static async _saveConfig(groupId, config) {
    const updateSql = `
      UPDATE teaching_global_authorizations 
      SET config_data = ?, 
          updated_at = NOW()
      WHERE group_id = ?
    `;
    
    await dbConnection.query(updateSql, [
      JSON.stringify(config),
      groupId
    ]);
  }

  static async getSuperAdminAuthorizationForGroup(groupId) {
    try {
      const config = await this._getConfig(groupId);
      
      if (!config) {
        return null;
      }

      if (config._version === '2.0.0') {
        return config._raw.superAdminConfig || null;
      }

      return config;
    } catch (error) {
      logger.error('获取超级管理员授权配置失败:', error);
      return null;
    }
  }

  static validatePermissionBoundary(requestedConfig, maxConfig) {
    const errors = [];

    if (!maxConfig) {
      errors.push('没有找到上级授权配置');
      return { valid: false, errors };
    }

    const maxModules = maxConfig.modulePermissions || [];
    const requestedModules = requestedConfig.modulePermissions || [];

    for (const reqModule of requestedModules) {
      const maxModule = maxModules.find(m => m.moduleId === reqModule.moduleId);
      
      if (!maxModule) {
        errors.push(`模块 ${reqModule.moduleName || reqModule.moduleId} 未被超级管理员授权`);
        continue;
      }

      if (reqModule.edit && !maxModule.edit) {
        errors.push(`模块 ${reqModule.moduleName} 的编辑权限超出授权范围`);
      }
      if (reqModule.view_plan && !maxModule.view_plan) {
        errors.push(`模块 ${reqModule.moduleName} 的查看教案权限超出授权范围`);
      }
      if (reqModule.view_lesson && !maxModule.view_lesson && !maxModule.view) {
        errors.push(`模块 ${reqModule.moduleName} 的查看课程权限超出授权范围`);
      }

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
   * 获取用户对模块的权限（修复：多标签权限合并）
   * @version 4.2.0 - 修复多标签bug
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

      // 1. 组级权限
      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      
      let groupHasViewLesson = groupModulePerm?.view_lesson || groupModulePerm?.view || false;
      let groupHasViewPlan = groupModulePerm?.view_plan || false;
      let groupHasEdit = groupModulePerm?.edit || false;
      
      if (!groupHasViewLesson && this._hasAnyLessonPermission(groupModulePerm)) {
        groupHasViewLesson = true;
      }

      // 【修复】初始化权限变量为false
      let hasViewLesson = false;
      let hasViewPlan = false;
      let hasEdit = false;

      // 2. 处理标签和用户权限
      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);
      
      // 【修复】如果用户没有标签，直接使用组权限
      if (userTagIds.length === 0) {
        return {
          hasViewLesson: groupHasViewLesson,
          hasViewPlan: groupHasViewPlan,
          hasEdit: groupHasEdit
        };
      }

      // 【修复】遍历所有匹配的标签，合并权限（取最大值）
      let foundMatchingTag = false;
      
      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        foundMatchingTag = true;
        let tagViewLesson, tagViewPlan, tagEdit;

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);
        
        if (userConfig) {
          // 用户有专属配置
          if (userConfig.inheritFromTag) {
            if (tag.inheritFromGroup) {
              tagViewLesson = groupHasViewLesson;
              tagViewPlan = groupHasViewPlan;
              tagEdit = groupHasEdit;
            } else {
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              if (tagModulePerm) {
                tagViewLesson = tagModulePerm.view_lesson || tagModulePerm.view || false;
                tagViewPlan = tagModulePerm.view_plan || false;
                tagEdit = tagModulePerm.edit || false;
                
                if (!tagViewLesson && this._hasAnyLessonPermission(tagModulePerm)) {
                  tagViewLesson = true;
                }
              } else {
                tagViewLesson = false;
                tagViewPlan = false;
                tagEdit = false;
              }
            }
          } else {
            // 用户有独立权限配置
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            if (userModulePerm) {
              tagViewLesson = userModulePerm.view_lesson || userModulePerm.view || false;
              tagViewPlan = userModulePerm.view_plan || false;
              tagEdit = userModulePerm.edit || false;
              
              if (!tagViewLesson && this._hasAnyLessonPermission(userModulePerm)) {
                tagViewLesson = true;
              }
            } else {
              tagViewLesson = false;
              tagViewPlan = false;
              tagEdit = false;
            }
          }
        } else {
          // 用户继承标签配置
          if (tag.inheritFromGroup) {
            tagViewLesson = groupHasViewLesson;
            tagViewPlan = groupHasViewPlan;
            tagEdit = groupHasEdit;
          } else {
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            if (tagModulePerm) {
              tagViewLesson = tagModulePerm.view_lesson || tagModulePerm.view || false;
              tagViewPlan = tagModulePerm.view_plan || false;
              tagEdit = tagModulePerm.edit || false;
              
              if (!tagViewLesson && this._hasAnyLessonPermission(tagModulePerm)) {
                tagViewLesson = true;
              }
            } else {
              tagViewLesson = false;
              tagViewPlan = false;
              tagEdit = false;
            }
          }
        }
        
        // 【修复】合并权限（取最大值）
        hasViewLesson = hasViewLesson || tagViewLesson;
        hasViewPlan = hasViewPlan || tagViewPlan;
        hasEdit = hasEdit || tagEdit;
        
        // 【修复】不要break，继续处理其他标签
      }

      // 如果没有找到匹配的标签，使用组权限
      if (!foundMatchingTag) {
        hasViewLesson = groupHasViewLesson;
        hasViewPlan = groupHasViewPlan;
        hasEdit = groupHasEdit;
      }

      logger.info('用户模块权限（多标签合并）', {
        userId,
        moduleId,
        userTagCount: userTagIds.length,
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
   * 获取用户对课程的权限（修复：多标签权限合并）
   * @version 4.2.0 - 修复多标签bug
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

      // 【修复】如果用户没有标签，直接返回组权限
      if (userTagIds.length === 0) {
        return {
          hasViewLesson: groupHasViewLesson,
          hasViewPlan: groupHasViewPlan,
          hasEdit: groupHasEdit
        };
      }

      // 【修复】遍历所有匹配的标签，合并权限
      let foundMatchingTag = false;

      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        foundMatchingTag = true;
        let tagViewLesson, tagViewPlan, tagEdit;

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);

        if (userConfig) {
          if (userConfig.inheritFromTag) {
            if (tag.inheritFromGroup) {
              tagViewLesson = groupHasViewLesson;
              tagViewPlan = groupHasViewPlan;
              tagEdit = groupHasEdit;
            } else {
              const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
              const tagLessonPerm = this._findLessonPermission(tagModulePerm?.lessons || [], lessonId);
              
              if (tagLessonPerm) {
                tagViewLesson = tagLessonPerm.view_lesson || tagLessonPerm.view || false;
                tagViewPlan = tagLessonPerm.view_plan || false;
                tagEdit = tagLessonPerm.edit || false;
              } else {
                tagViewLesson = tagModulePerm?.view_lesson || tagModulePerm?.view || false;
                tagViewPlan = tagModulePerm?.view_plan || false;
                tagEdit = tagModulePerm?.edit || false;
              }
            }
          } else {
            const userModulePerm = this._findModulePermission(userConfig.modulePermissions || [], moduleId);
            const userLessonPerm = this._findLessonPermission(userModulePerm?.lessons || [], lessonId);
            
            if (userLessonPerm) {
              tagViewLesson = userLessonPerm.view_lesson || userLessonPerm.view || false;
              tagViewPlan = userLessonPerm.view_plan || false;
              tagEdit = userLessonPerm.edit || false;
            } else {
              tagViewLesson = userModulePerm?.view_lesson || userModulePerm?.view || false;
              tagViewPlan = userModulePerm?.view_plan || false;
              tagEdit = userModulePerm?.edit || false;
            }
          }
        } else {
          if (tag.inheritFromGroup) {
            tagViewLesson = groupHasViewLesson;
            tagViewPlan = groupHasViewPlan;
            tagEdit = groupHasEdit;
          } else {
            const tagModulePerm = this._findModulePermission(tag.modulePermissions || [], moduleId);
            const tagLessonPerm = this._findLessonPermission(tagModulePerm?.lessons || [], lessonId);
            
            if (tagLessonPerm) {
              tagViewLesson = tagLessonPerm.view_lesson || tagLessonPerm.view || false;
              tagViewPlan = tagLessonPerm.view_plan || false;
              tagEdit = tagLessonPerm.edit || false;
            } else {
              tagViewLesson = tagModulePerm?.view_lesson || tagModulePerm?.view || false;
              tagViewPlan = tagModulePerm?.view_plan || false;
              tagEdit = tagModulePerm?.edit || false;
            }
          }
        }
        
        // 【修复】合并权限
        hasViewLesson = hasViewLesson || tagViewLesson;
        hasViewPlan = hasViewPlan || tagViewPlan;
        hasEdit = hasEdit || tagEdit;
      }

      if (!foundMatchingTag) {
        hasViewLesson = groupHasViewLesson;
        hasViewPlan = groupHasViewPlan;
        hasEdit = groupHasEdit;
      }

      logger.info('用户课程权限（多标签合并）', {
        userId,
        moduleId,
        lessonId,
        userTagCount: userTagIds.length,
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
   * 获取用户授权模块ID（修复：多标签权限合并）
   * @version 4.2.0 - 修复多标签bug
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

      // 组权限
      const groupPerms = config.modulePermissions || [];
      const groupModuleIds = new Set();
      groupPerms.forEach(perm => {
        if (perm.view_lesson || perm.view_plan || perm.edit || perm.view || this._hasAnyLessonPermission(perm)) {
          groupModuleIds.add(perm.moduleId);
        }
      });

      const tags = config.tags || [];
      const userTagIds = userTags.map(t => t.id);
      
      // 【修复】如果用户没有标签，直接返回组权限
      if (userTagIds.length === 0) {
        return Array.from(groupModuleIds);
      }

      // 【修复】遍历所有匹配的标签，合并模块ID
      let foundMatchingTag = false;

      for (const tag of tags) {
        if (!userTagIds.includes(tag.tagId)) {
          continue;
        }

        foundMatchingTag = true;

        const users = tag.users || [];
        const userConfig = users.find(u => u.userId === userId);

        if (userConfig) {
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
        
        // 【修复】不要break，继续处理其他标签
      }

      if (!foundMatchingTag) {
        groupModuleIds.forEach(id => moduleIds.add(id));
      }

      const result = Array.from(moduleIds);
      
      logger.info('用户授权模块列表（多标签合并）', {
        userId,
        userGroupId,
        userTagCount: userTagIds.length,
        totalModules: result.length
      });

      return result;
    } catch (error) {
      logger.error('获取用户授权模块ID失败:', error);
      return [];
    }
  }

  /**
   * 获取用户授权课程ID（保持原逻辑，单标签即可）
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

      const groupModulePerm = this._findModulePermission(config.modulePermissions || [], moduleId);
      
      if (!groupModulePerm) {
        return null;
      }

      const moduleHasPermission = groupModulePerm.view_lesson || 
                                  groupModulePerm.view_plan || 
                                  groupModulePerm.edit || 
                                  groupModulePerm.view || false;

      if (moduleHasPermission && (!groupModulePerm.lessons || groupModulePerm.lessons.length === 0)) {
        return null;
      }

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
          
          if (lessonConfig?.mode === 'all_except') {
            return {
              mode: 'all_except',
              deniedLessonIds: lessonConfig.deniedLessonIds || []
            };
          }
          
          if (effectiveModulePerm.lessons && effectiveModulePerm.lessons.length > 0) {
            const authorizedLessonIds = [];
            effectiveModulePerm.lessons.forEach(lesson => {
              if (lesson.view_lesson || lesson.view_plan || lesson.edit || lesson.view) {
                authorizedLessonIds.push(lesson.lessonId);
              }
            });
            return authorizedLessonIds;
          }
          
          return null;
        }
        
        break;
      }

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
}

module.exports = GlobalAuthorizationService;
