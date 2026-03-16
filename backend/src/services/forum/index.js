/**
 * 论坛模块 - 服务层统一导出
 * 
 * @module services/forum
 */

const ForumModeratorService = require('./ForumModeratorService');
const ForumNotificationService = require('./ForumNotificationService');
const ForumLikeService = require('./ForumLikeService');

module.exports = {
  ForumModeratorService,
  ForumNotificationService,
  ForumLikeService
};
