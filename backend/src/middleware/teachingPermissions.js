/**
 * 教学系统权限中间件
 * 基于用户角色、标签和明确授权的权限控制
 */

const TeachingModule = require('../models/TeachingModule');
const TeachingLesson = require('../models/TeachingLesson');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 获取用户的标签列表
 */
const getUserTags = async (userId) => {
  try {
    const dbConnection = require('../database/connection');
    const sql = `
      SELECT ut.id, ut.name, ut.color, ut.icon, ut.description
      FROM user_tag_relations utr
      JOIN user_tags ut ON utr.tag_id = ut.id
      WHERE utr.user_id = ? AND ut.is_active = 1
    `;
    const { rows } = await dbConnection.query(sql, [userId]);
    return rows;
  } catch (error) {
    logger.error('获取用户标签失败:', error);
    return [];
  }
};

/**
 * 检查用户是否可以创建教学模块
 * 规则：super_admin、admin 或拥有 developer 标签的用户
 */
const canCreateModule = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      // 超级管理员和管理员可以创建
      if (user.role === 'super_admin' || user.role === 'admin') {
        return next();
      }

      // 检查是否有 developer 标签
      const userTags = await getUserTags(user.id);
      const hasDeveloperTag = userTags.some(tag => tag.name === 'developer');

      if (hasDeveloperTag) {
        req.userTags = userTags; // 附加到请求对象供后续使用
        return next();
      }

      logger.warn('用户尝试创建教学模块但权限不足', {
        userId: user.id,
        username: user.username,
        role: user.role,
        tags: userTags.map(t => t.name)
      });

      return ResponseHelper.forbidden(res, '需要开发者权限才能创建教学模块');
    } catch (error) {
      logger.error('检查创建权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户是否可以编辑指定的教学模块
 * 规则：创建者、super_admin、admin 或有明确的 edit 权限
 */
const canEditModule = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const moduleId = req.params.id || req.params.moduleId;

      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!moduleId) {
        return ResponseHelper.validation(res, ['缺少模块ID']);
      }

      // 获取模块信息
      const module = await TeachingModule.findById(moduleId);
      if (!module) {
        return ResponseHelper.notFound(res, '教学模块不存在');
      }

      // 获取用户标签
      const userTags = await getUserTags(user.id);

      // 检查权限
      const permission = await TeachingModule.checkUserPermission(
        moduleId,
        user.id,
        user.role,
        user.group_id,
        userTags
      );

      if (permission === 'edit') {
        req.module = module; // 附加模块对象供后续使用
        req.userTags = userTags;
        return next();
      }

      logger.warn('用户尝试编辑教学模块但权限不足', {
        userId: user.id,
        username: user.username,
        moduleId,
        moduleName: module.name,
        permission
      });

      return ResponseHelper.forbidden(res, '无权编辑此教学模块');
    } catch (error) {
      logger.error('检查编辑权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户是否可以查看指定的教学模块
 * 规则：创建者、管理员、有明确授权或符合可见性规则
 */
const canViewModule = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const moduleId = req.params.id || req.params.moduleId;

      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!moduleId) {
        return ResponseHelper.validation(res, ['缺少模块ID']);
      }

      // 获取模块信息
      const module = await TeachingModule.findById(moduleId);
      if (!module) {
        return ResponseHelper.notFound(res, '教学模块不存在');
      }

      // 获取用户标签
      const userTags = await getUserTags(user.id);

      // 检查权限
      const permission = await TeachingModule.checkUserPermission(
        moduleId,
        user.id,
        user.role,
        user.group_id,
        userTags
      );

      if (permission) {
        req.module = module;
        req.userTags = userTags;
        req.modulePermission = permission; // 'edit' 或 'view'
        return next();
      }

      logger.warn('用户尝试查看教学模块但权限不足', {
        userId: user.id,
        username: user.username,
        moduleId,
        moduleName: module.name
      });

      return ResponseHelper.forbidden(res, '无权查看此教学模块');
    } catch (error) {
      logger.error('检查查看权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户是否可以删除指定的教学模块
 * 规则：创建者、super_admin 或 admin（同组）
 */
const canDeleteModule = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const moduleId = req.params.id || req.params.moduleId;

      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!moduleId) {
        return ResponseHelper.validation(res, ['缺少模块ID']);
      }

      // 获取模块信息
      const module = await TeachingModule.findById(moduleId);
      if (!module) {
        return ResponseHelper.notFound(res, '教学模块不存在');
      }

      // 超级管理员可以删除任何模块
      if (user.role === 'super_admin') {
        req.module = module;
        return next();
      }

      // 创建者可以删除自己的模块
      if (module.creator_id === user.id) {
        req.module = module;
        return next();
      }

      // 管理员可以删除同组的模块
      if (user.role === 'admin' && module.owner_group_id === user.group_id) {
        req.module = module;
        return next();
      }

      logger.warn('用户尝试删除教学模块但权限不足', {
        userId: user.id,
        username: user.username,
        moduleId,
        moduleName: module.name,
        creatorId: module.creator_id
      });

      return ResponseHelper.forbidden(res, '无权删除此教学模块');
    } catch (error) {
      logger.error('检查删除权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户是否可以查看指定的课程
 * 规则：需要先有模块查看权限，然后根据 content_type 判断
 */
const canViewLesson = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const lessonId = req.params.id || req.params.lessonId;

      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!lessonId) {
        return ResponseHelper.validation(res, ['缺少课程ID']);
      }

      // 获取课程信息
      const lesson = await TeachingLesson.findById(lessonId);
      if (!lesson) {
        return ResponseHelper.notFound(res, '课程不存在');
      }

      // 获取模块信息
      const module = await TeachingModule.findById(lesson.module_id);
      if (!module) {
        return ResponseHelper.notFound(res, '所属模块不存在');
      }

      // 获取用户标签
      const userTags = await getUserTags(user.id);

      // 检查模块访问权限
      const modulePermission = await TeachingModule.checkUserPermission(
        lesson.module_id,
        user.id,
        user.role,
        user.group_id,
        userTags
      );

      if (!modulePermission) {
        return ResponseHelper.forbidden(res, '无权访问此课程所属的教学模块');
      }

      // 检查课程内容类型访问权限
      const canView = TeachingLesson.canUserViewLesson(lesson, user.role, userTags);

      if (!canView) {
        logger.warn('用户尝试查看教师专属课程但权限不足', {
          userId: user.id,
          username: user.username,
          lessonId,
          lessonTitle: lesson.title,
          contentType: lesson.content_type,
          tags: userTags.map(t => t.name)
        });
        return ResponseHelper.forbidden(res, '该课程为教师专属内容，需要教师权限');
      }

      req.lesson = lesson;
      req.module = module;
      req.userTags = userTags;
      req.modulePermission = modulePermission;

      return next();
    } catch (error) {
      logger.error('检查课程查看权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户是否可以编辑指定的课程
 * 规则：需要有模块的 edit 权限
 */
const canEditLesson = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const lessonId = req.params.id || req.params.lessonId;

      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!lessonId) {
        return ResponseHelper.validation(res, ['缺少课程ID']);
      }

      // 获取课程信息
      const lesson = await TeachingLesson.findById(lessonId);
      if (!lesson) {
        return ResponseHelper.notFound(res, '课程不存在');
      }

      // 获取用户标签
      const userTags = await getUserTags(user.id);

      // 检查模块编辑权限
      const modulePermission = await TeachingModule.checkUserPermission(
        lesson.module_id,
        user.id,
        user.role,
        user.group_id,
        userTags
      );

      if (modulePermission !== 'edit') {
        logger.warn('用户尝试编辑课程但无模块编辑权限', {
          userId: user.id,
          username: user.username,
          lessonId,
          lessonTitle: lesson.title,
          modulePermission
        });
        return ResponseHelper.forbidden(res, '无权编辑此课程');
      }

      req.lesson = lesson;
      req.userTags = userTags;

      return next();
    } catch (error) {
      logger.error('检查课程编辑权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户是否可以管理模块权限
 * 规则：super_admin 或 admin（同组）
 */
const canManagePermissions = () => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const moduleId = req.params.moduleId || req.body.module_id;

      if (!user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!moduleId) {
        return ResponseHelper.validation(res, ['缺少模块ID']);
      }

      // 获取模块信息
      const module = await TeachingModule.findById(moduleId);
      if (!module) {
        return ResponseHelper.notFound(res, '教学模块不存在');
      }

      // 超级管理员可以管理所有权限
      if (user.role === 'super_admin') {
        req.module = module;
        return next();
      }

      // 管理员可以管理同组模块的权限
      if (user.role === 'admin') {
        if (module.owner_group_id === user.group_id) {
          req.module = module;
          return next();
        }
        return ResponseHelper.forbidden(res, '只能管理本组织的教学模块权限');
      }

      logger.warn('用户尝试管理模块权限但权限不足', {
        userId: user.id,
        username: user.username,
        role: user.role,
        moduleId
      });

      return ResponseHelper.forbidden(res, '需要管理员权限');
    } catch (error) {
      logger.error('检查权限管理权限失败:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

module.exports = {
  canCreateModule,
  canEditModule,
  canViewModule,
  canDeleteModule,
  canViewLesson,
  canEditLesson,
  canManagePermissions,
  getUserTags
};
