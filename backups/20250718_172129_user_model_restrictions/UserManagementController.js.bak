/**
 * 用户管理控制器 - 使用Service层处理业务逻辑
 */

const { UserService } = require('../../services/admin');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

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
}

module.exports = UserManagementController;
