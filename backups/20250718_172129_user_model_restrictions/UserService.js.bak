/**
 * 用户服务层 - 处理用户相关的业务逻辑
 */

const User = require('../../models/User');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');

class UserService {
  /**
   * 创建用户（包含业务验证）
   */
  static async createUser(userData, operatorId = null) {
    try {
      const {
        email,
        username,
        password,
        role = 'user',
        group_id = 1,
        status = 'active',
        token_quota = 10000,
        credits_quota = 1000,
        credits_expire_days = 365,
        remark = null
      } = userData;

      // 业务验证
      await UserService.validateUserData({ email, username, password });

      // 检查邮箱是否已存在
      const existingEmailUser = await User.findByEmail(email);
      if (existingEmailUser) {
        throw new ConflictError('该邮箱已被注册');
      }

      // 检查用户名是否已存在
      const existingUsernameUser = await User.findByUsername(username);
      if (existingUsernameUser) {
        throw new ConflictError('该用户名已被使用');
      }

      // 创建用户
      const newUser = await User.create({
        email: email.toLowerCase(),
        username,
        password,
        role,
        group_id,
        status,
        token_quota,
        credits_quota,
        credits_expire_days,
        remark
      });

      logger.info('用户创建成功', {
        operatorId,
        newUserId: newUser.id,
        email: newUser.email,
        role: newUser.role,
        group_id: newUser.group_id
      });

      return newUser;
    } catch (error) {
      logger.error('创建用户失败', { error: error.message, userData });
      throw error;
    }
  }

  /**
   * 更新用户信息
   */
  static async updateUser(userId, updateData, operatorId = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 如果要更新邮箱，检查是否已被使用
      if (updateData.email && updateData.email !== user.email) {
        const existingUser = await User.findByEmail(updateData.email);
        if (existingUser) {
          throw new ConflictError('该邮箱已被其他用户使用');
        }
      }

      // 如果要更新用户名，检查是否已被使用
      if (updateData.username && updateData.username !== user.username) {
        const existingUser = await User.findByUsername(updateData.username);
        if (existingUser) {
          throw new ConflictError('该用户名已被其他用户使用');
        }
      }

      // 执行更新
      const updatedUser = await user.update(updateData);

      logger.info('用户更新成功', {
        operatorId,
        userId,
        updateFields: Object.keys(updateData)
      });

      return updatedUser;
    } catch (error) {
      logger.error('更新用户失败', { error: error.message, userId, updateData });
      throw error;
    }
  }

  /**
   * 删除用户（软删除）
   */
  static async deleteUser(userId, operatorId = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 使用事务确保数据一致性
      await dbConnection.transaction(async (query) => {
        // 标记用户为已删除
        await query(
          'UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?',
          ['deleted', userId]
        );

        // 可以添加其他清理操作，如删除会话、令牌等
      });

      logger.info('用户删除成功', {
        operatorId,
        deletedUserId: userId,
        deletedEmail: user.email
      });

      return { success: true, message: '用户删除成功' };
    } catch (error) {
      logger.error('删除用户失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 重置用户密码
   */
  static async resetPassword(userId, newPassword, operatorId = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 验证密码强度
      if (!newPassword || newPassword.length < 6) {
        throw new ValidationError('密码长度至少6个字符');
      }

      await user.update({ password: newPassword });

      logger.info('用户密码重置成功', {
        operatorId,
        userId,
        userEmail: user.email
      });

      return { success: true, message: '密码重置成功' };
    } catch (error) {
      logger.error('重置密码失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 获取用户列表（支持高级过滤）
   */
  static async getUserList(filters = {}, currentUser = null) {
    try {
      const {
        page = 1,
        limit = 20,
        role,
        status,
        group_id,
        search,
        sort_by = 'created_at',
        sort_order = 'DESC'
      } = filters;

      // 调用模型方法获取列表
      const result = await User.getList({
        page,
        limit,
        role,
        status,
        group_id,
        search
      }, currentUser);

      return result;
    } catch (error) {
      logger.error('获取用户列表失败', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * 批量更新用户状态
   */
  static async batchUpdateStatus(userIds, status, operatorId = null) {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new ValidationError('用户ID列表不能为空');
      }

      if (!['active', 'inactive', 'suspended'].includes(status)) {
        throw new ValidationError('无效的用户状态');
      }

      // 使用事务批量更新
      const result = await dbConnection.transaction(async (query) => {
        const placeholders = userIds.map(() => '?').join(',');
        const sql = `
          UPDATE users 
          SET status = ?, updated_at = NOW() 
          WHERE id IN (${placeholders})
        `;
        
        const { rows } = await query(sql, [status, ...userIds]);
        return rows.affectedRows;
      });

      logger.info('批量更新用户状态成功', {
        operatorId,
        userIds,
        status,
        affectedCount: result
      });

      return {
        success: true,
        affectedCount: result,
        message: `成功更新${result}个用户的状态`
      };
    } catch (error) {
      logger.error('批量更新用户状态失败', { error: error.message, userIds, status });
      throw error;
    }
  }

  /**
   * 验证用户数据
   */
  static async validateUserData({ email, username, password }) {
    const errors = [];

    // 邮箱验证
    if (!email) {
      errors.push('邮箱不能为空');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push('邮箱格式不正确');
      }
    }

    // 用户名验证
    if (!username) {
      errors.push('用户名不能为空');
    } else {
      const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
      if (!usernameRegex.test(username)) {
        errors.push('用户名只能包含字母、数字、下划线和横线，长度3-20个字符');
      }
    }

    // 密码验证
    if (!password) {
      errors.push('密码不能为空');
    } else if (password.length < 6) {
      errors.push('密码长度至少6个字符');
    }

    if (errors.length > 0) {
      throw new ValidationError('数据验证失败', errors);
    }

    return true;
  }

  /**
   * 获取用户统计信息
   */
  static async getUserStats(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 获取用户的统计信息
      const stats = {
        basic: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
          created_at: user.created_at,
          last_login_at: user.last_login_at
        },
        tokens: {
          quota: user.token_quota,
          used: user.used_tokens,
          remaining: user.token_quota - user.used_tokens
        },
        credits: user.getCreditsStats()
      };

      return stats;
    } catch (error) {
      logger.error('获取用户统计信息失败', { error: error.message, userId });
      throw error;
    }
  }
}

module.exports = UserService;
