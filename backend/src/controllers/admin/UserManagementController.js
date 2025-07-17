/**
 * 用户管理控制器 - 负责用户的基础增删改查操作
 */

const User = require('../../models/User');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserManagementController {
  /**
   * 获取用户列表 - 基于用户组权限过滤
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
   * 获取用户详情 - 检查用户组权限
   */
  static async getUserDetail(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      
      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 检查权限：管理员只能查看同组用户
      if (currentUser.role === 'admin' && currentUser.group_id !== user.group_id) {
        logger.warn('管理员尝试查看其他组用户详情', {
          adminId: currentUser.id,
          adminGroupId: currentUser.group_id,
          targetUserId: user.id,
          targetGroupId: user.group_id
        });
        return ResponseHelper.forbidden(res, '无权查看其他组用户');
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
   * 创建用户 - 管理员只能创建同组用户
   */
  static async createUser(req, res) {
    try {
      const currentUser = req.user;
      const { 
        email, 
        username, 
        password, 
        role = 'user', 
        group_id = null,
        status = 'active', 
        token_quota = 10000,
        credits_quota = 1000,
        remark = null
      } = req.body;

      // 权限检查
      if (currentUser.role === 'admin') {
        // 管理员只能创建同组的普通用户
        if (role !== 'user') {
          return ResponseHelper.forbidden(res, '管理员只能创建普通用户');
        }
        
        // 强制设置为管理员所在组
        const finalGroupId = currentUser.group_id;
        
        const user = await User.create({
          email,
          username,
          password,
          role: 'user', // 管理员只能创建普通用户
          group_id: finalGroupId,
          status,
          token_quota,
          credits_quota,
          remark // 允许管理员设置备注
        });

        logger.info('管理员创建同组用户成功', { 
          adminId: currentUser.id,
          adminGroupId: currentUser.group_id,
          newUserId: user.id,
          email,
          role: 'user',
          group_id: finalGroupId
        });

        return ResponseHelper.success(res, user.toJSON(), '用户创建成功', 201);
      }

      // 超级管理员可以创建任何用户并设置备注
      const user = await User.create({
        email,
        username,
        password,
        role,
        group_id: group_id || null,
        status,
        token_quota,
        credits_quota,
        remark
      });

      logger.info('超级管理员创建用户成功', { 
        adminId: currentUser.id,
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
   * 更新用户 - 基于用户组权限
   */
  static async updateUser(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const updateData = req.body;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 权限检查
      if (currentUser.role === 'admin') {
        // 管理员只能更新同组用户
        if (currentUser.group_id !== user.group_id) {
          logger.warn('管理员尝试更新其他组用户', {
            adminId: currentUser.id,
            adminGroupId: currentUser.group_id,
            targetUserId: user.id,
            targetGroupId: user.group_id
          });
          return ResponseHelper.forbidden(res, '无权更新其他组用户');
        }

        // 管理员不能修改的字段（移除了remark，允许管理员修改备注）
        const restrictedFields = ['role', 'group_id', 'credits_quota', 'token_quota', 'credits_expire_at'];
        restrictedFields.forEach(field => {
          if (field in updateData) {
            delete updateData[field];
            logger.warn('管理员尝试修改受限字段', {
              adminId: currentUser.id,
              field,
              targetUserId: user.id
            });
          }
        });

        // 管理员不能将用户提升为管理员
        if (updateData.role && updateData.role !== 'user') {
          return ResponseHelper.forbidden(res, '管理员不能修改用户角色');
        }
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
   * 删除用户 - 基于用户组权限
   */
  static async deleteUser(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 权限检查
      if (currentUser.role === 'admin') {
        // 管理员只能删除同组的普通用户
        if (currentUser.group_id !== user.group_id) {
          return ResponseHelper.forbidden(res, '无权删除其他组用户');
        }
        
        if (user.role !== 'user') {
          return ResponseHelper.forbidden(res, '管理员只能删除普通用户');
        }
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
   * 重置用户密码 - 基于用户组权限
   */
  static async resetUserPassword(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return ResponseHelper.validation(res, ['密码长度至少6位']);
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 权限检查
      const hasPermission = await currentUser.hasPermission('user.password.group', user.id);
      if (!hasPermission) {
        logger.warn('无权重置用户密码', {
          adminId: currentUser.id,
          adminRole: currentUser.role,
          adminGroupId: currentUser.group_id,
          targetUserId: user.id,
          targetGroupId: user.group_id
        });
        return ResponseHelper.forbidden(res, '无权重置该用户密码');
      }

      // 使用 password 字段而不是 password_hash，让 User 模型自动处理加密
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
