/**
 * 用户服务层 - 处理用户相关的业务逻辑（包含账号有效期管理和标签支持）
 */

const User = require('../../models/User');
const AIModel = require('../../models/AIModel');
const GroupService = require('./GroupService');
const SystemConfig = require('../../models/SystemConfig');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');
const moment = require('moment');

class UserService {
  /**
   * 创建用户（包含业务验证）
   */
  static async createUser(userData, operatorId = null) {
    try {
      // 先获取系统配置的默认值
      let defaultTokens = 10000;
      let defaultCredits = 1000;
      let defaultGroupId = 1;
      
      try {
        const systemSettings = await SystemConfig.getFormattedSettings();
        if (systemSettings.user) {
          // 修复：正确处理0值
          defaultTokens = systemSettings.user.default_tokens !== undefined 
            ? systemSettings.user.default_tokens 
            : 10000;
            
          defaultCredits = systemSettings.user.default_credits !== undefined 
            ? systemSettings.user.default_credits 
            : 1000;
            
          defaultGroupId = systemSettings.user.default_group_id !== undefined 
            ? systemSettings.user.default_group_id 
            : 1;
        }
        
        logger.info('创建用户使用系统配置的默认值', {
          defaultTokens,
          defaultCredits,
          defaultGroupId
        });
      } catch (configError) {
        logger.warn('获取系统配置失败，使用内置默认值', { error: configError.message });
      }

      const {
        email,
        username,
        password,
        role = 'user',
        group_id = defaultGroupId,
        status = 'active',
        token_quota = defaultTokens,
        credits_quota = defaultCredits,
        credits_expire_days = 365,
        account_expire_days = null, // 账号有效期天数（新增）
        expire_at = null, // 直接设置有效期
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

      // 检查目标组是否还有容量
      const hasCapacity = await GroupService.checkGroupCapacity(group_id);
      if (!hasCapacity) {
        const group = await GroupService.findGroupById(group_id);
        const currentCount = await GroupService.getGroupUserCount(group_id);
        throw new ValidationError(`该组已满员（${currentCount}/${group.user_limit}），无法添加新成员`);
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
        account_expire_days,
        expire_at,
        remark
      });

      logger.info('用户创建成功', {
        operatorId,
        newUserId: newUser.id,
        email: newUser.email,
        role: newUser.role,
        group_id: newUser.group_id,
        token_quota: newUser.token_quota,
        credits_quota: newUser.credits_quota,
        accountExpireAt: newUser.expire_at
      });

      return newUser;
    } catch (error) {
      logger.error('创建用户失败', { error: error.message, userData });
      throw error;
    }
  }

  /**
   * 更新用户信息（包含分组变更时的积分处理和有效期同步）
   */
  static async updateUser(userId, updateData, operatorId = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 获取操作者信息
      let operatorUser = null;
      if (operatorId) {
        operatorUser = await User.findById(operatorId);
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

      // 处理有效期更新（新增验证逻辑）
      if (updateData.expire_at !== undefined && operatorUser) {
        // 组管理员的权限验证
        if (operatorUser.role === 'admin') {
          // 组管理员只能管理本组用户
          if (user.group_id !== operatorUser.group_id) {
            throw new ValidationError('无权设置其他组用户的有效期');
          }
          
          // 组管理员不能设置超级管理员的有效期
          if (user.role === 'super_admin') {
            throw new ValidationError('组管理员无权设置超级管理员的有效期');
          }
          
          // 如果设置了有效期，需要验证不超过组有效期
          if (updateData.expire_at) {
            const group = await GroupService.findGroupById(user.group_id);
            if (group.expire_date) {
              const userExpireDate = moment(updateData.expire_at, 'YYYY-MM-DD');
              const groupExpireDate = moment(group.expire_date, 'YYYY-MM-DD');
              
              if (userExpireDate.isAfter(groupExpireDate)) {
                throw new ValidationError(`用户有效期不能超过组有效期 ${group.expire_date}`);
              }
            }
          }
        }
        
        // 超级管理员账号不设置有效期
        if (user.role === 'super_admin' && updateData.expire_at) {
          delete updateData.expire_at;
          logger.info('超级管理员账号不设置有效期，已忽略expire_at字段');
        }
      }

      // 检查是否有分组变更
      const isGroupChanged = updateData.group_id !== undefined && 
                           parseInt(updateData.group_id) !== parseInt(user.group_id);

      if (isGroupChanged) {
        // 检查目标组是否还有容量
        const hasCapacity = await GroupService.checkGroupCapacity(updateData.group_id);
        if (!hasCapacity) {
          const group = await GroupService.findGroupById(updateData.group_id);
          const currentCount = await GroupService.getGroupUserCount(updateData.group_id);
          throw new ValidationError(`目标组已满员（${currentCount}/${group.user_limit}），无法加入`);
        }

        // 处理分组变更时的积分
        const userRemainingCredits = Math.max(0, user.credits_quota - user.used_credits);
        const originalGroupId = user.group_id;

        // 使用事务处理分组变更和积分操作
        await dbConnection.transaction(async (query) => {
          // 1. 只有从非默认组转出时，才返还积分到原组积分池
          if (originalGroupId !== 1 && userRemainingCredits > 0) {
            // 获取原组信息
            const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
            const { rows: groupRows } = await query(groupSql, [originalGroupId]);
            
            if (groupRows.length > 0) {
              // 更新组积分池（减少已使用额度）
              const updateGroupSql = `
                UPDATE user_groups 
                SET credits_pool_used = GREATEST(0, credits_pool_used - ?), 
                    updated_at = NOW() 
                WHERE id = ?
              `;
              await query(updateGroupSql, [userRemainingCredits, originalGroupId]);

              logger.info('分组变更：返还用户剩余积分到原组积分池', {
                groupId: originalGroupId,
                returnedCredits: userRemainingCredits
              });
            }
          }

          // 2. 获取新组的有效期设置（新增）
          let newExpireAt = null;
          if (user.role !== 'super_admin') { // 超级管理员不设置有效期
            const newGroupSql = 'SELECT expire_date FROM user_groups WHERE id = ?';
            const { rows: newGroupRows } = await query(newGroupSql, [updateData.group_id]);
            
            if (newGroupRows.length > 0 && newGroupRows[0].expire_date) {
              newExpireAt = newGroupRows[0].expire_date;
              logger.info('同步新组的有效期', {
                groupId: updateData.group_id,
                expireDate: newExpireAt
              });
            }
          }

          // 3. 更新用户信息，包括清零积分和同步有效期
          const finalUpdateData = {
            ...updateData,
            credits_quota: 0  // 分组变更时清零积分
          };

          // 如果需要同步有效期
          if (newExpireAt !== null) {
            finalUpdateData.expire_at = newExpireAt;
          }

          // 构建更新SQL
          const updateFields = Object.keys(finalUpdateData);
          const setClause = updateFields.map(field => `${field} = ?`).join(', ');
          const values = updateFields.map(field => finalUpdateData[field]);
          values.push(userId);

          const updateUserSql = `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ?`;
          await query(updateUserSql, values);

          // 4. 记录积分变动（如果有）
          if (userRemainingCredits > 0) {
            // 使用已存在的 transaction_type
            const transactionType = originalGroupId === 1 ? 'admin_set' : 'group_recycle';
            const description = originalGroupId === 1 
              ? `分组变更（从默认组到组${updateData.group_id}），积分清零` 
              : `分组变更（从组${originalGroupId}到组${updateData.group_id}），积分清零并返还到原组积分池`;
              
            const transactionSql = `
              INSERT INTO credit_transactions 
              (user_id, amount, balance_after, transaction_type, description, operator_id)
              VALUES (?, ?, 0, ?, ?, ?)
            `;
            await query(transactionSql, [
              userId,
              -userRemainingCredits, // 负数表示扣减
              transactionType,
              description,
              operatorId
            ]);
          }
        });

        logger.info('用户分组变更成功', {
          operatorId,
          userId,
          originalGroupId,
          newGroupId: updateData.group_id,
          clearedCredits: userRemainingCredits
        });

        // 重新获取更新后的用户信息
        return await User.findById(userId);
      } else {
        // 没有分组变更，执行普通更新
        const updatedUser = await user.update(updateData);

        logger.info('用户更新成功', {
          operatorId,
          userId,
          updateFields: Object.keys(updateData)
        });

        return updatedUser;
      }
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
   * 获取用户列表（支持高级过滤和标签）
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
        include_tags = false,  // 新增：是否包含标签信息
        sort_by = 'created_at',
        sort_order = 'DESC'
      } = filters;

      // 调用模型方法获取列表，传递include_tags参数
      const result = await User.getList({
        page,
        limit,
        role,
        status,
        group_id,
        search,
        include_tags  // 传递标签参数
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
   * 获取用户统计信息（包含账号有效期信息）
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
          last_login_at: user.last_login_at,
          group_id: user.group_id,
          group_name: user.group_name
        },
        tokens: {
          quota: user.token_quota,
          used: user.used_tokens,
          remaining: user.token_quota - user.used_tokens
        },
        credits: user.getCreditsStats(),
        account: {
          expire_at: user.expire_at,
          is_expired: user.isAccountExpired(),
          remaining_days: user.getAccountRemainingDays(),
          group_expire_date: user.group_expire_date
        }
      };

      return stats;
    } catch (error) {
      logger.error('获取用户统计信息失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 获取用户的模型权限信息
   */
  static async getUserModelPermissions(userId, operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 权限检查：组管理员只能查看本组用户
      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权查看其他组用户的模型权限');
      }

      // 获取用户组的所有可用模型
      const groupModels = await AIModel.getAvailableModelsByGroup(user.group_id);
      
      // 获取用户的模型限制
      const restrictions = await AIModel.getUserModelRestrictions(userId);
      const restrictedModelIds = restrictions.map(r => r.id);

      // 构建模型权限信息
      const modelPermissions = groupModels.map(model => ({
        id: model.id,
        name: model.name,
        display_name: model.display_name,
        is_restricted: restrictedModelIds.includes(model.id),
        credits_per_chat: model.credits_per_chat,
        stream_enabled: model.stream_enabled,
        image_upload_enabled: model.image_upload_enabled
      }));

      return {
        user_id: userId,
        username: user.username,
        group_id: user.group_id,
        group_name: user.group_name,
        total_models: groupModels.length,
        restricted_models: restrictions.length,
        available_models: groupModels.length - restrictions.length,
        models: modelPermissions,
        restrictions: restrictions
      };
    } catch (error) {
      logger.error('获取用户模型权限失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 更新用户的模型限制
   */
  static async updateUserModelRestrictions(userId, restrictedModelIds, operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 权限检查：组管理员只能管理本组用户
      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权管理其他组用户的模型权限');
      }

      // 获取用户组的所有可用模型
      const groupModels = await AIModel.getAvailableModelsByGroup(user.group_id);
      const groupModelIds = groupModels.map(m => m.id);

      // 验证限制的模型是否都在组的可用模型中
      const invalidModelIds = restrictedModelIds.filter(id => !groupModelIds.includes(id));
      if (invalidModelIds.length > 0) {
        throw new ValidationError('包含无效的模型ID：这些模型不在用户组的可用范围内');
      }

      // 不允许限制所有模型
      if (restrictedModelIds.length === groupModels.length) {
        throw new ValidationError('不能限制用户使用所有模型，至少要保留一个可用模型');
      }

      // 更新模型限制
      await AIModel.updateUserModelRestrictions(userId, restrictedModelIds, operatorUser.id);

      logger.info('用户模型限制更新成功', {
        operatorId: operatorUser.id,
        userId,
        restrictedCount: restrictedModelIds.length,
        availableCount: groupModels.length - restrictedModelIds.length
      });

      // 返回更新后的权限信息
      return await UserService.getUserModelPermissions(userId, operatorUser);
    } catch (error) {
      logger.error('更新用户模型限制失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 将用户挪出当前组（移到默认组）
   */
  static async removeUserFromGroup(userId, operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 检查用户是否已在默认组
      if (user.group_id === 1) {
        throw new ValidationError('用户已在默认组，无需挪出');
      }

      // 权限检查
      if (operatorUser.role === 'admin') {
        // 组管理员只能挪出本组用户
        if (user.group_id !== operatorUser.group_id) {
          throw new ValidationError('无权挪出其他组的用户');
        }
        // 组管理员不能挪出自己
        if (user.id === operatorUser.id) {
          throw new ValidationError('不能将自己挪出组');
        }
      }

      // 超级管理员不能互相挪出
      if (user.role === 'super_admin' && operatorUser.role === 'super_admin') {
        throw new ValidationError('超级管理员之间不能互相挪出');
      }

      // 计算用户剩余积分
      const userRemainingCredits = Math.max(0, user.credits_quota - user.used_credits);
      const originalGroupId = user.group_id;

      // 使用事务处理所有操作
      const result = await dbConnection.transaction(async (query) => {
        // 1. 获取原组信息
        const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
        const { rows: groupRows } = await query(groupSql, [originalGroupId]);
        
        if (groupRows.length === 0) {
          throw new ValidationError('原组不存在');
        }
        
        const originalGroup = groupRows[0];

        // 2. 只有从非默认组挪出时，才返还积分到组积分池
        let actualReturnedCredits = 0;
        if (originalGroupId !== 1 && userRemainingCredits > 0) {
          // 更新组积分池（减少已使用额度）
          const updateGroupSql = `
            UPDATE user_groups 
            SET credits_pool_used = GREATEST(0, credits_pool_used - ?), 
                updated_at = NOW() 
            WHERE id = ?
          `;
          await query(updateGroupSql, [userRemainingCredits, originalGroupId]);
          actualReturnedCredits = userRemainingCredits;

          logger.info('返还用户剩余积分到组积分池', {
            groupId: originalGroupId,
            returnedCredits: actualReturnedCredits
          });
        }

        // 3. 将用户移动到默认组并清零积分，同时清除账号有效期（如果不是超管）
        let updateUserSql = `
          UPDATE users 
          SET group_id = 1, 
              credits_quota = 0,
              updated_at = NOW() 
          WHERE id = ?
        `;
        
        // 非超管用户移到默认组时清除有效期
        if (user.role !== 'super_admin') {
          updateUserSql = `
            UPDATE users 
            SET group_id = 1, 
                credits_quota = 0,
                expire_at = NULL,
                updated_at = NOW() 
            WHERE id = ?
          `;
        }
        
        await query(updateUserSql, [userId]);

        // 4. 记录积分变动（如果有）
        if (userRemainingCredits > 0) {
          // 使用已存在的 transaction_type
          const transactionType = originalGroupId === 1 ? 'admin_set' : 'group_recycle';
          const description = originalGroupId === 1 
            ? '从默认组挪出，积分清零' 
            : `挪出组时返还积分到组积分池`;
            
          const transactionSql = `
            INSERT INTO credit_transactions 
            (user_id, amount, balance_after, transaction_type, description, operator_id)
            VALUES (?, ?, 0, ?, ?, ?)
          `;
          await query(transactionSql, [
            userId,
            -userRemainingCredits, // 负数表示扣减
            transactionType,
            description,
            operatorUser.id
          ]);
        }

        return {
          originalGroupId,
          originalGroupName: originalGroup.name,
          returnedCredits: actualReturnedCredits
        };
      });

      logger.info('用户挪出组成功', {
        operatorId: operatorUser.id,
        userId,
        userEmail: user.email,
        originalGroupId: result.originalGroupId,
        returnedCredits: result.returnedCredits
      });

      return {
        success: true,
        message: '用户已成功挪出组',
        details: {
          userId,
          username: user.username,
          email: user.email,
          originalGroup: result.originalGroupName,
          returnedCredits: result.returnedCredits,
          newGroupId: 1
        }
      };
    } catch (error) {
      logger.error('挪出用户失败', { error: error.message, userId, operatorId: operatorUser.id });
      throw error;
    }
  }

  /**
   * 设置用户账号有效期（新增）
   */
  static async setUserAccountExpireDate(userId, expireDate, reason = '管理员设置', operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 权限检查：组管理员只能管理本组用户
      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权设置其他组用户的有效期');
      }

      // 组管理员不能设置超级管理员的有效期
      if (operatorUser.role === 'admin' && user.role === 'super_admin') {
        throw new ValidationError('组管理员无权设置超级管理员的有效期');
      }

      // 组管理员设置的有效期不能超过组有效期
      if (operatorUser.role === 'admin' && expireDate) {
        const group = await GroupService.findGroupById(user.group_id);
        if (group.expire_date) {
          const userExpireDate = moment(expireDate, 'YYYY-MM-DD');
          const groupExpireDate = moment(group.expire_date, 'YYYY-MM-DD');
          
          if (userExpireDate.isAfter(groupExpireDate)) {
            throw new ValidationError(`用户有效期不能超过组有效期 ${group.expire_date}`);
          }
        }
      }

      // 调用用户模型的方法设置有效期
      const result = await user.setAccountExpireDate(expireDate, reason, operatorUser.id);

      logger.info('设置用户账号有效期成功', {
        operatorId: operatorUser.id,
        userId,
        expireDate,
        reason
      });

      return result;
    } catch (error) {
      logger.error('设置用户账号有效期失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 延长用户账号有效期（新增）
   */
  static async extendUserAccountExpireDate(userId, days, reason = '管理员延期', operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 权限检查：组管理员只能管理本组用户
      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权延长其他组用户的有效期');
      }

      // 组管理员不能延长超级管理员的有效期
      if (operatorUser.role === 'admin' && user.role === 'super_admin') {
        throw new ValidationError('组管理员无权延长超级管理员的有效期');
      }

      // 组管理员延长后的有效期不能超过组有效期
      if (operatorUser.role === 'admin') {
        const group = await GroupService.findGroupById(user.group_id);
        if (group.expire_date) {
          const currentExpireDate = user.expire_at ? moment(user.expire_at) : moment();
          const newExpireDate = currentExpireDate.clone().add(days, 'days');
          const groupExpireDate = moment(group.expire_date, 'YYYY-MM-DD');
          
          if (newExpireDate.isAfter(groupExpireDate)) {
            throw new ValidationError(`延长后的有效期不能超过组有效期 ${group.expire_date}`);
          }
        }
      }

      // 调用用户模型的方法延长有效期
      const result = await user.extendAccountExpireDate(days, reason, operatorUser.id);

      logger.info('延长用户账号有效期成功', {
        operatorId: operatorUser.id,
        userId,
        days,
        reason
      });

      return result;
    } catch (error) {
      logger.error('延长用户账号有效期失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 同步用户有效期到组有效期（新增）
   */
  static async syncUserAccountExpireWithGroup(userId, operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 权限检查：组管理员只能管理本组用户
      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权同步其他组用户的有效期');
      }

      // 调用用户模型的方法同步有效期
      const result = await user.syncAccountExpireWithGroup();

      logger.info('同步用户有效期成功', {
        operatorId: operatorUser.id,
        userId,
        result
      });

      return result;
    } catch (error) {
      logger.error('同步用户有效期失败', { error: error.message, userId });
      throw error;
    }
  }
}

module.exports = UserService;
