/**
 * 权限中间件统一导出
 */

const groupAdminMiddleware = require('./groupAdminMiddleware');
const superAdminMiddleware = require('./superAdminMiddleware');

module.exports = {
  // 组管理员权限
  ...groupAdminMiddleware,
  
  // 超级管理员权限
  ...superAdminMiddleware
};
