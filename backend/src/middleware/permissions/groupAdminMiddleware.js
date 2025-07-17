/**
 * 组管理员权限中间件
 * 处理基于用户组的权限检查
 */

const User = require('../../models/User');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * 检查是否可以操作目标用户（基于用户组）
 */
const canManageUser = () => {
  return async (req, res, next) => {
    try {
      const currentUser = req.user;
      const targetUserId = req.params.id;
      
      // 超级管理员可以操作所有用户
      if (currentUser.role === 'super_admin') {
        return next();
      }
      
      // 获取目标用户
      if (targetUserId) {
        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
          return ResponseHelper.notFound(res, '用户不存在');
        }
        
        // 将目标用户信息附加到请求对象
        req.targetUser = targetUser;
        
        // 组管理员只能操作同组用户
        if (currentUser.role === 'admin') {
          if (currentUser.group_id !== targetUser.group_id) {
            logger.warn('组管理员尝试操作其他组用户', {
              adminId: currentUser.id,
              adminGroupId: currentUser.group_id,
              targetUserId: targetUser.id,
              targetGroupId: targetUser.group_id,
              action: req.method + ' ' + req.originalUrl
            });
            return ResponseHelper.forbidden(res, '无权操作其他组的用户');
          }
          
          // 组管理员不能操作其他管理员
          if (targetUser.role !== 'user') {
            return ResponseHelper.forbidden(res, '组管理员只能管理普通用户');
          }
        }
      }
      
      next();
    } catch (error) {
      logger.error('用户管理权限检查失败', {
        error: error.message,
        adminId: req.user?.id,
        targetUserId: req.params.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以创建用户（基于用户组）
 */
const canCreateUser = () => {
  return async (req, res, next) => {
    try {
      const currentUser = req.user;
      const { role, group_id } = req.body;
      
      // 超级管理员可以创建任何用户
      if (currentUser.role === 'super_admin') {
        return next();
      }
      
      // 组管理员的限制
      if (currentUser.role === 'admin') {
        // 只能创建普通用户
        if (role && role !== 'user') {
          return ResponseHelper.forbidden(res, '组管理员只能创建普通用户');
        }
        
        // 强制设置为管理员所在组
        req.body.group_id = currentUser.group_id;
        req.body.role = 'user';
      }
      
      next();
    } catch (error) {
      logger.error('创建用户权限检查失败', {
        error: error.message,
        adminId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 限制组管理员可修改的字段
 */
const restrictFieldsForGroupAdmin = () => {
  return (req, res, next) => {
    try {
      const currentUser = req.user;
      
      // 超级管理员不受限制
      if (currentUser.role === 'super_admin') {
        return next();
      }
      
      // 组管理员不能修改的字段
      if (currentUser.role === 'admin') {
        const restrictedFields = ['role', 'group_id', 'credits_quota', 'token_quota', 'credits_expire_at'];
        
        restrictedFields.forEach(field => {
          if (field in req.body) {
            delete req.body[field];
            logger.warn('组管理员尝试修改受限字段', {
              adminId: currentUser.id,
              field,
              targetUserId: req.params.id
            });
          }
        });
      }
      
      next();
    } catch (error) {
      logger.error('字段限制检查失败', {
        error: error.message,
        adminId: req.user?.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

/**
 * 检查是否可以查看用户积分（只读权限）
 */
const canViewCredits = () => {
  return async (req, res, next) => {
    try {
      const currentUser = req.user;
      const targetUserId = req.params.id;
      
      if (!targetUserId) {
        return next();
      }
      
      // 超级管理员可以查看所有
      if (currentUser.role === 'super_admin') {
        return next();
      }
      
      // 组管理员只能查看同组用户的积分
      if (currentUser.role === 'admin') {
        const targetUser = req.targetUser || await User.findById(targetUserId);
        if (!targetUser) {
          return ResponseHelper.notFound(res, '用户不存在');
        }
        
        if (currentUser.group_id !== targetUser.group_id) {
          return ResponseHelper.forbidden(res, '无权查看其他组用户的积分信息');
        }
      }
      
      next();
    } catch (error) {
      logger.error('积分查看权限检查失败', {
        error: error.message,
        adminId: req.user?.id,
        targetUserId: req.params.id
      });
      return ResponseHelper.error(res, '权限验证失败');
    }
  };
};

module.exports = {
  canManageUser,
  canCreateUser,
  restrictFieldsForGroupAdmin,
  canViewCredits
};
