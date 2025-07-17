/**
 * 管理员控制器 - 兼容层
 * 将原有的大控制器功能委托给拆分后的专门控制器
 * 这样可以保持现有路由不变，逐步迁移
 */

const UserManagementController = require('./admin/UserManagementController');
const UserCreditsController = require('./admin/UserCreditsController');
const UserGroupController = require('./admin/UserGroupController');
const AIModelController = require('./admin/AIModelController');
const SystemStatsController = require('./admin/SystemStatsController');

class AdminController {
  // ===== 系统统计 =====
  static getSystemStats = SystemStatsController.getSystemStats;
  static getSystemSettings = SystemStatsController.getSystemSettings;
  static updateSystemSettings = SystemStatsController.updateSystemSettings;

  // ===== 用户管理 =====
  static getUsers = UserManagementController.getUsers;
  static getUserDetail = UserManagementController.getUserDetail;
  static createUser = UserManagementController.createUser;
  static updateUser = UserManagementController.updateUser;
  static deleteUser = UserManagementController.deleteUser;
  static resetUserPassword = UserManagementController.resetUserPassword;

  // ===== 积分管理 =====
  static getUserCredits = UserCreditsController.getUserCredits;
  static setUserCredits = UserCreditsController.setUserCredits;
  static addUserCredits = UserCreditsController.addUserCredits;
  static deductUserCredits = UserCreditsController.deductUserCredits;
  static setUserCreditsExpire = UserCreditsController.setUserCreditsExpire;
  static getUserCreditsHistory = UserCreditsController.getUserCreditsHistory;

  // ===== 用户分组管理 =====
  static getUserGroups = UserGroupController.getUserGroups;
  static createUserGroup = UserGroupController.createUserGroup;
  static updateUserGroup = UserGroupController.updateUserGroup;
  static deleteUserGroup = UserGroupController.deleteUserGroup;

  // ===== AI模型管理 =====
  static getAIModels = AIModelController.getAIModels;
  static createAIModel = AIModelController.createAIModel;
  static updateAIModel = AIModelController.updateAIModel;
  static deleteAIModel = AIModelController.deleteAIModel;
  static testAIModel = AIModelController.testAIModel;
}

module.exports = AdminController;
