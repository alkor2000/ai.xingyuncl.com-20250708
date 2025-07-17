/**
 * 用户管理控制器 - 使用中间件处理权限，移除重复检查
 */

const User = require('../../models/User');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserManagementController {
  /**
   * 获取用户列表 - 权限过滤已在中间件处理
   */
  static async getUsers(req, res) {
    try {
      const currentUser = req.user;
      const { 
        page = 1, 
        limit = 20, 
        role = null, 
        status = null, 
        group_id = null,
        search = null 
      } = req.query;

      // 传递当前用户信息用于权限过滤
      const result = await User.getList({
        page: parseInt(page),
        limit: parseInt(limit),
        role,
        status,
        group_id: group_id ? parseInt(group_id) : null,
        search
      }, currentUser);

      return ResponseHelper.paginated(res, result.users, result.pagination, '获取用户列表成功');
    } catch (error) {
      logger.error('获取用户列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户列表失败');
    }
  }

  /**
   * 获取用户详情 - 权限检查已在中间件处理
   */
  static async getUserDetail(req, res) {
    try {
      const { id } = req.params;
      const user = req.targetUser || await User.findById(id);
      
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const permissions = await user.getPermissions();

      logger.info('获取用户详情成功', { 
        adminId: req.user.id,
        targetUserId: id
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions
      }, '获取用户详情成功');
    } catch (error) {
      logger.error('获取用户详情失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户详情失败');
    }
  }

  /**
   * 创建用户 - 权限和字段限制已在中间件处理
   */
  static async createUser(req, res) {
    try {
      const currentUser = req.user;
      const { 
        email, 
        username, 
        password, 
        role, 
        group_id,
        status = 'active', 
        token_quota = 10000,
        credits_quota = 1000,
        remark = null
      } = req.body;

      const user = await User.create({
        email,
        username,
        password,
        role,
        group_id,
        status,
        token_quota,
        credits_quota,
        remark
      });

      logger.info('创建用户成功', { 
        adminId: currentUser.id,
        adminRole: currentUser.role,
        newUserId: user.id,
        email,
        role,
        group_id
      });

      return ResponseHelper.success(res, user.toJSON(), '用户创建成功', 201);
    } catch (error) {
      logger.error('创建用户失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '创建用户失败');
    }
  }

  /**
   * 更新用户 - 权限和字段限制已在中间件处理
   */
  static async updateUser(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const updateData = req.body;

      const user = req.targetUser || await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const updatedUser = await user.update(updateData);

      logger.info('更新用户成功', { 
        adminId: currentUser.id,
        adminRole: currentUser.role,
        targetUserId: id,
        updateFields: Object.keys(updateData)
      });

      return ResponseHelper.success(res, updatedUser.toJSON(), '用户更新成功');
    } catch (error) {
      logger.error('更新用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '更新用户失败');
    }
  }

  /**
   * 删除用户 - 权限检查已在中间件处理
   */
  static async deleteUser(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;

      const user = req.targetUser || await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 防止删除自己
      if (user.id === currentUser.id) {
        return ResponseHelper.forbidden(res, '不能删除自己的账户');
      }

      await user.delete();

      logger.info('删除用户成功', { 
        adminId: currentUser.id,
        adminRole: currentUser.role,
        deletedUserId: id,
        deletedEmail: user.email
      });

      return ResponseHelper.success(res, null, '用户删除成功');
    } catch (error) {
      logger.error('删除用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '删除用户失败');
    }
  }

  /**
   * 重置用户密码 - 权限检查已在中间件处理
   */
  static async resetUserPassword(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return ResponseHelper.validation(res, ['密码长度至少6位']);
      }

      const user = req.targetUser || await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      await user.update({ password: newPassword });

      logger.info('管理员重置用户密码成功', { 
        adminId: currentUser.id,
        adminRole: currentUser.role,
        targetUserId: id,
        targetEmail: user.email
      });

      return ResponseHelper.success(res, null, '密码重置成功');
    } catch (error) {
      logger.error('重置用户密码失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '密码重置失败');
    }
  }
}

module.exports = UserManagementController;
