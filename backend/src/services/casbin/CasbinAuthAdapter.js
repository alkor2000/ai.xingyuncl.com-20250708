/**
 * Casbin权限适配器
 * 
 * 功能：
 * - 提供与GlobalAuthorizationService兼容的接口
 * - 支持并行模式：Casbin和原系统同时工作
 * - 提供权限检查结果对比和日志记录
 * - 支持灰度切换
 */

const CasbinService = require('./CasbinService');
const GlobalAuthorizationService = require('../GlobalAuthorizationService');
const logger = require('../../utils/logger');
const config = require('../../config');

class CasbinAuthAdapter {
  constructor() {
    // 控制开关：是否启用Casbin
    this.casbinEnabled = process.env.ENABLE_CASBIN === 'true' || false;
    // 控制开关：是否使用Casbin结果（否则只记录对比）
    this.useCasbinResult = process.env.USE_CASBIN_RESULT === 'true' || false;
    // 是否记录权限检查对比
    this.logComparison = process.env.LOG_PERMISSION_COMPARISON === 'true' || true;
  }

  /**
   * 获取用户对模块的权限（兼容接口）
   */
  async getUserModulePermission(userId, moduleId, userGroupId, userTags = []) {
    try {
      // 1. 获取原系统权限结果
      const originalResult = await GlobalAuthorizationService.getUserModulePermission(
        userId, moduleId, userGroupId, userTags
      );

      if (!this.casbinEnabled) {
        return originalResult;
      }

      // 2. 获取Casbin权限结果
      const casbinResult = await this.getCasbinModulePermission(userId, moduleId, userGroupId, userTags);

      // 3. 对比结果
      if (this.logComparison) {
        this.compareResults('module_permission', {
          userId, moduleId, userGroupId,
          original: originalResult,
          casbin: casbinResult
        });
      }

      // 4. 返回结果（根据配置决定使用哪个）
      return this.useCasbinResult ? casbinResult : originalResult;

    } catch (error) {
      logger.error('获取模块权限失败:', error);
      // 出错时降级到原系统
      return GlobalAuthorizationService.getUserModulePermission(
        userId, moduleId, userGroupId, userTags
      );
    }
  }

  /**
   * 获取用户对课程的权限（兼容接口）
   */
  async getUserLessonPermission(userId, moduleId, lessonId, userGroupId, userTags = []) {
    try {
      // 1. 获取原系统权限结果
      const originalResult = await GlobalAuthorizationService.getUserLessonPermission(
        userId, moduleId, lessonId, userGroupId, userTags
      );

      if (!this.casbinEnabled) {
        return originalResult;
      }

      // 2. 获取Casbin权限结果
      const casbinResult = await this.getCasbinLessonPermission(
        userId, moduleId, lessonId, userGroupId, userTags
      );

      // 3. 对比结果
      if (this.logComparison) {
        this.compareResults('lesson_permission', {
          userId, moduleId, lessonId, userGroupId,
          original: originalResult,
          casbin: casbinResult
        });
      }

      // 4. 返回结果
      return this.useCasbinResult ? casbinResult : originalResult;

    } catch (error) {
      logger.error('获取课程权限失败:', error);
      return GlobalAuthorizationService.getUserLessonPermission(
        userId, moduleId, lessonId, userGroupId, userTags
      );
    }
  }

  /**
   * 获取用户授权的模块ID列表（兼容接口）
   */
  async getUserAuthorizedModuleIds(userId, userGroupId, userTags = []) {
    try {
      // 1. 获取原系统结果
      const originalResult = await GlobalAuthorizationService.getUserAuthorizedModuleIds(
        userId, userGroupId, userTags
      );

      if (!this.casbinEnabled) {
        return originalResult;
      }

      // 2. 获取Casbin结果
      const casbinResult = await this.getCasbinAuthorizedModuleIds(userId, userGroupId, userTags);

      // 3. 对比结果
      if (this.logComparison) {
        this.compareArrayResults('authorized_modules', {
          userId, userGroupId,
          original: originalResult,
          casbin: casbinResult
        });
      }

      // 4. 返回结果
      return this.useCasbinResult ? casbinResult : originalResult;

    } catch (error) {
      logger.error('获取授权模块列表失败:', error);
      return GlobalAuthorizationService.getUserAuthorizedModuleIds(userId, userGroupId, userTags);
    }
  }

  /**
   * 获取用户授权的课程ID列表（兼容接口）
   */
  async getUserAuthorizedLessonIds(userId, moduleId, userGroupId, userTags = []) {
    try {
      // 1. 获取原系统结果
      const originalResult = await GlobalAuthorizationService.getUserAuthorizedLessonIds(
        userId, moduleId, userGroupId, userTags
      );

      if (!this.casbinEnabled) {
        return originalResult;
      }

      // 2. 获取Casbin结果
      const casbinResult = await this.getCasbinAuthorizedLessonIds(
        userId, moduleId, userGroupId, userTags
      );

      // 3. 对比结果
      if (this.logComparison && originalResult !== null && casbinResult !== null) {
        this.compareArrayResults('authorized_lessons', {
          userId, moduleId, userGroupId,
          original: originalResult,
          casbin: casbinResult
        });
      }

      // 4. 返回结果
      return this.useCasbinResult ? casbinResult : originalResult;

    } catch (error) {
      logger.error('获取授权课程列表失败:', error);
      return GlobalAuthorizationService.getUserAuthorizedLessonIds(
        userId, moduleId, userGroupId, userTags
      );
    }
  }

  // ==================== Casbin实现 ====================

  /**
   * 使用Casbin获取模块权限
   */
  async getCasbinModulePermission(userId, moduleId, userGroupId, userTags) {
    const hasView = await this.checkCasbinPermission(
      userId, moduleId, 'view', userGroupId, userTags, 'module'
    );
    const hasEdit = await this.checkCasbinPermission(
      userId, moduleId, 'edit', userGroupId, userTags, 'module'
    );

    return { hasView, hasEdit };
  }

  /**
   * 使用Casbin获取课程权限
   */
  async getCasbinLessonPermission(userId, moduleId, lessonId, userGroupId, userTags) {
    // 先检查课程权限
    let hasView = await this.checkCasbinPermission(
      userId, lessonId, 'view', userGroupId, userTags, 'lesson'
    );
    let hasEdit = await this.checkCasbinPermission(
      userId, lessonId, 'edit', userGroupId, userTags, 'lesson'
    );

    // 如果没有课程权限，检查模块权限（继承）
    if (!hasView) {
      hasView = await this.checkCasbinPermission(
        userId, moduleId, 'view', userGroupId, userTags, 'module'
      );
    }
    if (!hasEdit) {
      hasEdit = await this.checkCasbinPermission(
        userId, moduleId, 'edit', userGroupId, userTags, 'module'
      );
    }

    return { hasView, hasEdit };
  }

  /**
   * 使用Casbin获取授权模块列表
   */
  async getCasbinAuthorizedModuleIds(userId, userGroupId, userTags) {
    const moduleIds = new Set();

    // 获取用户的所有权限
    const userKey = `user:${userId}`;
    const groupKey = `group:${userGroupId}`;
    
    // 获取用户直接权限
    const userPerms = await CasbinService.getPermissionsForUser(userKey);
    
    // 获取组权限
    const groupPerms = await CasbinService.getPermissionsForUser(groupKey);
    
    // 获取标签权限
    for (const tag of userTags) {
      const tagKey = `tag:${tag.id}`;
      const tagPerms = await CasbinService.getPermissionsForUser(tagKey);
      
      // 解析模块ID
      for (const perm of tagPerms) {
        if (perm[1] && perm[1].startsWith('module:')) {
          const moduleId = parseInt(perm[1].replace('module:', ''));
          if (!isNaN(moduleId)) {
            moduleIds.add(moduleId);
          }
        }
      }
    }

    // 解析用户权限中的模块ID
    for (const perm of [...userPerms, ...groupPerms]) {
      if (perm[1] && perm[1].startsWith('module:')) {
        const moduleId = parseInt(perm[1].replace('module:', ''));
        if (!isNaN(moduleId)) {
          moduleIds.add(moduleId);
        }
      }
    }

    return Array.from(moduleIds);
  }

  /**
   * 使用Casbin获取授权课程列表
   */
  async getCasbinAuthorizedLessonIds(userId, moduleId, userGroupId, userTags) {
    // 先检查是否有模块权限
    const hasModuleView = await this.checkCasbinPermission(
      userId, moduleId, 'view', userGroupId, userTags, 'module'
    );

    if (hasModuleView) {
      // 检查是否有被拒绝的课程
      const deniedLessonIds = await this.getCasbinDeniedLessonIds(
        userId, moduleId, userGroupId, userTags
      );

      if (deniedLessonIds.length > 0) {
        return {
          mode: 'all_except',
          deniedLessonIds
        };
      }

      // 有模块权限且没有被拒绝的课程
      return null;
    }

    // 没有模块权限，返回明确授权的课程
    const authorizedLessonIds = await this.getCasbinExplicitLessonIds(
      userId, moduleId, userGroupId, userTags
    );

    return authorizedLessonIds;
  }

  /**
   * 检查Casbin权限
   */
  async checkCasbinPermission(userId, resourceId, action, userGroupId, userTags, resourceType) {
    // 构建主体列表（用户、标签、组）
    const subjects = [
      `user:${userId}`,
      `group:${userGroupId}`,
      ...userTags.map(tag => `tag:${tag.id}`)
    ];

    // 构建资源标识
    const resource = `${resourceType}:${resourceId}`;

    // 检查每个主体的权限
    for (const subject of subjects) {
      const hasPermission = await CasbinService.checkPermission(subject, resource, action);
      if (hasPermission) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取被拒绝的课程ID
   */
  async getCasbinDeniedLessonIds(userId, moduleId, userGroupId, userTags) {
    const deniedIds = [];
    
    // TODO: 实现获取deny策略的逻辑
    // 需要查询casbin_rule表中effect为deny的记录
    
    return deniedIds;
  }

  /**
   * 获取明确授权的课程ID
   */
  async getCasbinExplicitLessonIds(userId, moduleId, userGroupId, userTags) {
    const lessonIds = [];
    
    // TODO: 实现获取明确授权课程的逻辑
    
    return lessonIds;
  }

  // ==================== 辅助方法 ====================

  /**
   * 对比权限结果
   */
  compareResults(type, data) {
    const { original, casbin } = data;
    const isSame = JSON.stringify(original) === JSON.stringify(casbin);

    if (!isSame) {
      logger.warn('权限检查结果不一致', {
        type,
        ...data,
        difference: {
          hasView: original.hasView !== casbin.hasView ? 
            `原系统:${original.hasView} vs Casbin:${casbin.hasView}` : 'same',
          hasEdit: original.hasEdit !== casbin.hasEdit ? 
            `原系统:${original.hasEdit} vs Casbin:${casbin.hasEdit}` : 'same'
        }
      });
    }
  }

  /**
   * 对比数组结果
   */
  compareArrayResults(type, data) {
    const { original, casbin } = data;
    
    if (original === null && casbin === null) return;
    
    const originalSet = new Set(Array.isArray(original) ? original : []);
    const casbinSet = new Set(Array.isArray(casbin) ? casbin : []);
    
    const onlyInOriginal = [...originalSet].filter(x => !casbinSet.has(x));
    const onlyInCasbin = [...casbinSet].filter(x => !originalSet.has(x));
    
    if (onlyInOriginal.length > 0 || onlyInCasbin.length > 0) {
      logger.warn('权限列表结果不一致', {
        type,
        userId: data.userId,
        onlyInOriginal,
        onlyInCasbin,
        originalCount: originalSet.size,
        casbinCount: casbinSet.size
      });
    }
  }

  /**
   * 切换到Casbin模式
   */
  enableCasbin(useResult = false) {
    this.casbinEnabled = true;
    this.useCasbinResult = useResult;
    logger.info('Casbin已启用', { useResult });
  }

  /**
   * 切换回原系统
   */
  disableCasbin() {
    this.casbinEnabled = false;
    this.useCasbinResult = false;
    logger.info('Casbin已禁用，使用原系统');
  }
}

module.exports = new CasbinAuthAdapter();
