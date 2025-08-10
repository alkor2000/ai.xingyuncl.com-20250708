/**
 * 用户管理控制器 - 使用Service层处理业务逻辑（包含账号有效期管理）
 */

const { UserService } = require('../../services/admin');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const CacheService = require('../../services/cacheService');

class UserManagementController {
  /**
   * 获取用户列表
   */
  static async getUsers(req, res) {
    try {
      const currentUser = req.user;
      const filters = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        role: req.query.role,
        status: req.query.status,
        group_id: req.query.group_id ? parseInt(req.query.group_id) : null,
        search: req.query.search
      };

      const result = await UserService.getUserList(filters, currentUser);

      return ResponseHelper.paginated(res, result.users, result.pagination, '获取用户列表成功');
    } catch (error) {
      logger.error('获取用户列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取用户列表失败');
    }
  }

  /**
   * 获取用户详情
   */
  static async getUserDetail(req, res) {
    try {
      const { id } = req.params;
      const stats = await UserService.getUserStats(id);

      return ResponseHelper.success(res, stats, '获取用户详情成功');
    } catch (error) {
      logger.error('获取用户详情失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '获取用户详情失败');
    }
  }

  /**
   * 创建用户
   */
  static async createUser(req, res) {
    try {
      const currentUser = req.user;
      const userData = req.body;
      
      const newUser = await UserService.createUser(userData, currentUser.id);

      return ResponseHelper.success(res, newUser.toJSON(), '用户创建成功', 201);
    } catch (error) {
      logger.error('创建用户失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      
      if (error.message.includes('已被注册') || error.message.includes('已被使用')) {
        return ResponseHelper.error(res, error.message, 409);
      }
      
      return ResponseHelper.error(res, error.message || '创建用户失败');
    }
  }

  /**
   * 更新用户
   */
  static async updateUser(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const updateData = req.body;

      const updatedUser = await UserService.updateUser(id, updateData, currentUser.id);

      return ResponseHelper.success(res, updatedUser.toJSON(), '用户更新成功');
    } catch (error) {
      logger.error('更新用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('已被') && error.message.includes('使用')) {
        return ResponseHelper.error(res, error.message, 409);
      }
      
      return ResponseHelper.error(res, error.message || '更新用户失败');
    }
  }

  /**
   * 删除用户
   */
  static async deleteUser(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;

      // 防止删除自己
      if (parseInt(id) === currentUser.id) {
        return ResponseHelper.forbidden(res, '不能删除自己的账户');
      }

      const result = await UserService.deleteUser(id, currentUser.id);

      return ResponseHelper.success(res, null, result.message);
    } catch (error) {
      logger.error('删除用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '删除用户失败');
    }
  }

  /**
   * 重置用户密码
   */
  static async resetUserPassword(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { newPassword } = req.body;

      const result = await UserService.resetPassword(id, newPassword, currentUser.id);

      return ResponseHelper.success(res, null, result.message);
    } catch (error) {
      logger.error('重置用户密码失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('密码')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '密码重置失败');
    }
  }

  /**
   * 获取用户的模型权限
   */
  static async getUserModelPermissions(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;

      const permissions = await UserService.getUserModelPermissions(id, currentUser);

      return ResponseHelper.success(res, permissions, '获取用户模型权限成功');
    } catch (error) {
      logger.error('获取用户模型权限失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('无权')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '获取用户模型权限失败');
    }
  }

  /**
   * 更新用户的模型限制
   */
  static async updateUserModelRestrictions(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { restricted_model_ids = [] } = req.body;

      if (!Array.isArray(restricted_model_ids)) {
        return ResponseHelper.validation(res, ['restricted_model_ids 必须是数组']);
      }

      const result = await UserService.updateUserModelRestrictions(
        id, 
        restricted_model_ids,
        currentUser
      );

      // 清除相关缓存
      await CacheService.clearAIModelsCache();
      await CacheService.clearUserPermissionsCache();



      return ResponseHelper.success(res, result, '用户模型限制更新成功');
    } catch (error) {
      logger.error('更新用户模型限制失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('无权')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      if (error.message.includes('无效') || error.message.includes('不能限制')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '更新用户模型限制失败');
    }
  }

  /**
   * 将用户挪出当前组
   */
  static async removeUserFromGroup(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;

      const result = await UserService.removeUserFromGroup(id, currentUser);

      return ResponseHelper.success(res, result.details, result.message);
    } catch (error) {
      logger.error('挪出用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message === '用户已在默认组，无需挪出') {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      if (error.message.includes('无权') || error.message.includes('不能')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '挪出用户失败');
    }
  }

  /**
   * 设置用户账号有效期（新增）
   */
  static async setUserAccountExpireDate(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { expire_date, reason } = req.body;

      if (!expire_date) {
        return ResponseHelper.validation(res, ['有效期日期不能为空']);
      }

      // 验证日期格式
      const expireDate = new Date(expire_date);
      if (isNaN(expireDate.getTime())) {
        return ResponseHelper.validation(res, ['无效的日期格式']);
      }

      const result = await UserService.setUserAccountExpireDate(
        id, 
        expireDate, 
        reason,
        currentUser
      );

      return ResponseHelper.success(res, result, '账号有效期设置成功');
    } catch (error) {
      logger.error('设置用户账号有效期失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('无权')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      if (error.message.includes('超级管理员')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '设置账号有效期失败');
    }
  }

  /**
   * 延长用户账号有效期（新增）
   */
  static async extendUserAccountExpireDate(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { days, reason } = req.body;

      if (!days || days <= 0) {
        return ResponseHelper.validation(res, ['延长天数必须大于0']);
      }

      const result = await UserService.extendUserAccountExpireDate(
        id, 
        parseInt(days), 
        reason,
        currentUser
      );

      return ResponseHelper.success(res, result, '账号有效期延长成功');
    } catch (error) {
      logger.error('延长用户账号有效期失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('无权')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      if (error.message.includes('超级管理员')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '延长账号有效期失败');
    }
  }

  /**
   * 同步用户有效期到组有效期（新增）
   */
  static async syncUserAccountExpireWithGroup(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;

      const result = await UserService.syncUserAccountExpireWithGroup(id, currentUser);

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('同步用户有效期失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('无权')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      if (error.message.includes('超级管理员') || error.message.includes('未设置有效期')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '同步有效期失败');
    }
  }
}

module.exports = UserManagementController;
