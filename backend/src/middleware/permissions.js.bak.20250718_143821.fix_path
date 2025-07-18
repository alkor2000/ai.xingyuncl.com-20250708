/**
 * 权限中间件 - 基于角色的访问控制
 */

const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 角色常量
 */
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user'
};

/**
 * 检查是否可以查看系统设置
 */
const canViewSystem = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      
      // 超级管理员和组管理员都可以查看
      if (userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN) {
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权访问系统设置');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以管理系统设置
 */
const canManageSystem = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      
      // 只有超级管理员可以管理
      if (userRole === ROLES.SUPER_ADMIN) {
        return next();
      }
      
      // 组管理员只能查看，不能修改
      if (userRole === ROLES.ADMIN) {
        if (req.method === 'GET') {
          return next();
        }
        return ResponseHelper.forbidden(res, '组管理员只能查看系统设置，不能修改');
      }
      
      return ResponseHelper.forbidden(res, '无权管理系统设置');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以查看AI模型
 */
const canViewAIModels = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      
      // 超级管理员和组管理员都可以查看
      if (userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN) {
        // 在req中标记用户角色，供控制器使用
        req.userRole = userRole;
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权查看AI模型');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以管理AI模型
 */
const canManageAIModels = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      
      // 只有超级管理员可以管理
      if (userRole === ROLES.SUPER_ADMIN) {
        return next();
      }
      
      return ResponseHelper.forbidden(res, '只有超级管理员可以管理AI模型');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以查看积分
 */
const canViewCredits = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      
      // 超级管理员可以查看所有
      if (userRole === ROLES.SUPER_ADMIN) {
        req.canViewAllGroups = true;
        return next();
      }
      
      // 组管理员只能查看本组
      if (userRole === ROLES.ADMIN) {
        req.canViewAllGroups = false;
        req.limitToGroupId = userGroupId;
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权查看积分信息');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以管理积分
 */
const canManageCredits = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      
      // 超级管理员可以管理所有
      if (userRole === ROLES.SUPER_ADMIN) {
        req.canManageAllGroups = true;
        return next();
      }
      
      // 组管理员只能管理本组
      if (userRole === ROLES.ADMIN) {
        req.canManageAllGroups = false;
        req.limitToGroupId = userGroupId;
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权管理积分');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以查看用户
 */
const canViewUsers = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      
      // 超级管理员可以查看所有
      if (userRole === ROLES.SUPER_ADMIN) {
        req.canViewAllGroups = true;
        return next();
      }
      
      // 组管理员只能查看本组
      if (userRole === ROLES.ADMIN) {
        req.canViewAllGroups = false;
        req.limitToGroupId = userGroupId;
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权查看用户列表');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以管理用户
 */
const canManageUsers = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      
      // 超级管理员可以管理所有
      if (userRole === ROLES.SUPER_ADMIN) {
        req.canManageAllGroups = true;
        return next();
      }
      
      // 组管理员只能管理本组
      if (userRole === ROLES.ADMIN) {
        req.canManageAllGroups = false;
        req.limitToGroupId = userGroupId;
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权管理用户');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以管理特定用户
 */
const canManageUser = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      const targetUserId = req.params.id;
      
      // 超级管理员可以管理所有用户
      if (userRole === ROLES.SUPER_ADMIN) {
        return next();
      }
      
      // 组管理员需要检查目标用户是否在同组
      if (userRole === ROLES.ADMIN) {
        // 从数据库获取目标用户信息
        const dbConnection = require('../../database/connection');
        const [users] = await dbConnection.query(
          'SELECT group_id FROM users WHERE id = ?',
          [targetUserId]
        );
        
        if (users.length === 0) {
          return ResponseHelper.notFound(res, '用户不存在');
        }
        
        const targetUserGroupId = users[0].group_id;
        
        // 检查是否同组
        if (targetUserGroupId !== userGroupId) {
          return ResponseHelper.forbidden(res, '只能管理本组用户');
        }
        
        req.limitToGroupId = userGroupId;
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权管理用户');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以创建用户
 */
const canCreateUser = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      
      // 超级管理员可以创建任何用户
      if (userRole === ROLES.SUPER_ADMIN) {
        return next();
      }
      
      // 组管理员只能创建本组用户
      if (userRole === ROLES.ADMIN) {
        // 检查请求体中的group_id
        const requestedGroupId = req.body.group_id;
        
        // 如果指定了组ID，必须是管理员的组
        if (requestedGroupId && parseInt(requestedGroupId) !== userGroupId) {
          return ResponseHelper.forbidden(res, '只能创建本组用户');
        }
        
        // 强制设置为管理员的组ID
        req.body.group_id = userGroupId;
        
        // 组管理员不能创建管理员角色
        if (req.body.role && req.body.role !== 'user') {
          return ResponseHelper.forbidden(res, '组管理员只能创建普通用户');
        }
        
        return next();
      }
      
      return ResponseHelper.forbidden(res, '无权创建用户');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 限制组管理员可以修改的字段
 */
const restrictFieldsForGroupAdmin = () => {
  return (req, res, next) => {
    try {
      const userRole = req.user.role;
      
      // 超级管理员不受限制
      if (userRole === ROLES.SUPER_ADMIN) {
        return next();
      }
      
      // 组管理员不能修改某些字段
      if (userRole === ROLES.ADMIN) {
        const restrictedFields = ['role', 'group_id'];
        
        // 检查是否尝试修改受限字段
        for (const field of restrictedFields) {
          if (req.body.hasOwnProperty(field)) {
            delete req.body[field];
            logger.warn('组管理员尝试修改受限字段', {
              adminId: req.user.id,
              field: field,
              targetUserId: req.params.id
            });
          }
        }
      }
      
      next();
    } catch (error) {
      logger.error('字段限制检查错误:', error);
      return ResponseHelper.error(res, '请求验证失败');
    }
  };
};

/**
 * 检查是否可以管理用户组
 */
const canManageGroups = () => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '请先登录');
      }
      
      const userRole = req.user.role;
      
      // 只有超级管理员可以管理用户组
      if (userRole === ROLES.SUPER_ADMIN) {
        return next();
      }
      
      // 组管理员不能创建、修改或删除用户组
      return ResponseHelper.forbidden(res, '只有超级管理员可以管理用户组');
    } catch (error) {
      logger.error('权限检查错误:', error);
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

module.exports = {
  ROLES,
  canViewSystem,
  canManageSystem,
  canViewAIModels,
  canManageAIModels,
  canViewCredits,
  canManageCredits,
  canViewUsers,
  canManageUsers,
  canManageUser,
  canCreateUser,
  restrictFieldsForGroupAdmin,
  canManageGroups
};
