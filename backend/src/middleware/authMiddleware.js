/**
 * 认证中间件
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * JWT认证中间件
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      return ResponseHelper.unauthorized(res, '缺少认证令牌');
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return ResponseHelper.unauthorized(res, '无效的令牌格式');
    }

    try {
      const decoded = jwt.verify(token, config.auth.jwt.accessSecret);
      
      // 验证token类型
      if (decoded.type !== 'access') {
        return ResponseHelper.unauthorized(res, '无效的令牌类型');
      }

      // 获取用户信息
      const user = await User.findById(decoded.userId);
      
      if (!user) {
        return ResponseHelper.unauthorized(res, '用户不存在');
      }

      if (user.status !== 'active') {
        return ResponseHelper.unauthorized(res, '用户账户已被禁用');
      }

      // 将用户信息添加到request对象
      req.user = user;
      req.token = token;
      
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return ResponseHelper.unauthorized(res, '访问令牌已过期');
      } else if (jwtError.name === 'JsonWebTokenError') {
        return ResponseHelper.unauthorized(res, '无效的访问令牌');
      } else {
        logger.error('JWT验证失败:', jwtError);
        return ResponseHelper.unauthorized(res, '令牌验证失败');
      }
    }
  } catch (error) {
    logger.error('认证中间件错误:', error);
    return ResponseHelper.error(res, '认证服务异常');
  }
};

/**
 * 角色检查中间件
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      const userRole = req.user.role;
      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      if (!allowedRoles.includes(userRole)) {
        return ResponseHelper.forbidden(res, '权限不足');
      }

      next();
    } catch (error) {
      logger.error('角色检查中间件错误:', error);
      return ResponseHelper.error(res, '权限验证异常');
    }
  };
};

/**
 * 权限检查中间件
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      // 获取用户权限
      const userPermissions = await req.user.getPermissions();
      
      // 检查是否有所需权限
      const hasPermission = userPermissions.some(p => {
        if (p === permission) return true;
        
        // 检查通配符权限 (如 admin.*, system.*)
        if (p.endsWith('.*')) {
          const prefix = p.slice(0, -1);
          return permission.startsWith(prefix);
        }
        
        return false;
      });

      if (!hasPermission) {
        return ResponseHelper.forbidden(res, '权限不足');
      }

      next();
    } catch (error) {
      logger.error('权限检查中间件错误:', error);
      return ResponseHelper.error(res, '权限验证异常');
    }
  };
};

/**
 * Token配额检查中间件
 */
const checkTokenQuota = (estimatedTokens) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return ResponseHelper.unauthorized(res, '用户未认证');
      }

      if (!req.user.hasTokenQuota(estimatedTokens)) {
        return ResponseHelper.forbidden(res, 'Token配额不足');
      }

      next();
    } catch (error) {
      logger.error('Token配额检查中间件错误:', error);
      return ResponseHelper.error(res, 'Token配额验证异常');
    }
  };
};

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  checkTokenQuota
};
