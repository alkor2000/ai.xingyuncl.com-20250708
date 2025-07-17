/**
 * 超级管理员权限中间件
 * 处理需要超级管理员权限的操作
 */

const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * 要求超级管理员权限
 */
const requireSuperAdmin = () => {
  return (req, res, next) => {
    try {
      const currentUser = req.user;
      
      if (!currentUser) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }
      
      if (currentUser.role !== 'super_admin') {
        logger.warn('非超级管理员尝试访问受限资源', {
          userId: currentUser.id,
          userRole: currentUser.role,
          attemptedAction: req.method + ' ' + req.originalUrl
        });
        return ResponseHelper.forbidden(res, '需要超级管理员权限');
      }
      
      next();
    } catch (error) {
      logger.error('超级管理员权限检查失败', {
        error: error.message,
        userId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查积分管理权限（只有超级管理员可以修改积分）
 */
const canManageCredits = () => {
  return (req, res, next) => {
    try {
      const currentUser = req.user;
      
      if (!currentUser) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }
      
      if (currentUser.role !== 'super_admin') {
        const action = req.method === 'GET' ? '查看' : '管理';
        logger.warn(`非超级管理员尝试${action}积分`, {
          userId: currentUser.id,
          userRole: currentUser.role,
          attemptedAction: req.method + ' ' + req.originalUrl
        });
        return ResponseHelper.forbidden(res, `只有超级管理员可以${action}积分配额`);
      }
      
      next();
    } catch (error) {
      logger.error('积分管理权限检查失败', {
        error: error.message,
        userId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查系统配置权限
 */
const canManageSystem = () => {
  return (req, res, next) => {
    try {
      const currentUser = req.user;
      
      if (!currentUser) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }
      
      if (currentUser.role !== 'super_admin') {
        logger.warn('非超级管理员尝试修改系统配置', {
          userId: currentUser.id,
          userRole: currentUser.role,
          attemptedAction: req.method + ' ' + req.originalUrl
        });
        return ResponseHelper.forbidden(res, '只有超级管理员可以管理系统配置');
      }
      
      next();
    } catch (error) {
      logger.error('系统管理权限检查失败', {
        error: error.message,
        userId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查AI模型管理权限
 */
const canManageAIModels = () => {
  return (req, res, next) => {
    try {
      const currentUser = req.user;
      
      if (!currentUser) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }
      
      if (currentUser.role !== 'super_admin') {
        logger.warn('非超级管理员尝试管理AI模型', {
          userId: currentUser.id,
          userRole: currentUser.role,
          attemptedAction: req.method + ' ' + req.originalUrl
        });
        return ResponseHelper.forbidden(res, '只有超级管理员可以管理AI模型配置');
      }
      
      next();
    } catch (error) {
      logger.error('AI模型管理权限检查失败', {
        error: error.message,
        userId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查用户组管理权限
 */
const canManageGroups = () => {
  return (req, res, next) => {
    try {
      const currentUser = req.user;
      
      if (!currentUser) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }
      
      if (currentUser.role !== 'super_admin') {
        logger.warn('非超级管理员尝试管理用户组', {
          userId: currentUser.id,
          userRole: currentUser.role,
          attemptedAction: req.method + ' ' + req.originalUrl
        });
        return ResponseHelper.forbidden(res, '只有超级管理员可以管理用户分组');
      }
      
      next();
    } catch (error) {
      logger.error('用户组管理权限检查失败', {
        error: error.message,
        userId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

module.exports = {
  requireSuperAdmin,
  canManageCredits,
  canManageSystem,
  canManageAIModels,
  canManageGroups
};
