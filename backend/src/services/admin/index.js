/**
 * 管理服务层统一导出
 */

const UserService = require('./UserService');
const CreditsService = require('./CreditsService');
const GroupService = require('./GroupService');
const StatsService = require('./StatsService');

module.exports = {
  UserService,
  CreditsService,
  GroupService,
  StatsService
};
