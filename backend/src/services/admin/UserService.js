/**
 * 用户服务层 - 处理用户相关的业务逻辑
 * 
 * 功能包含：
 * - 用户CRUD操作（含软删除）
 * - 账号有效期管理
 * - 标签支持
 * - 批量创建用户（v1.1新增）
 * 
 * 修复/更新记录：
 * - v1.1 (2025-01-XX): 
 *   * 邮箱改为非必填项
 *   * 新增批量创建用户功能，支持从组积分池扣减
 * - deleteUser方法改为调用User Model的softDelete()
 * - 支持软删除，保留所有关联数据
 */

const User = require('../../models/User');
const AIModel = require('../../models/AIModel');
const GroupService = require('./GroupService');
const SystemConfig = require('../../models/SystemConfig');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');
const moment = require('moment');
const bcrypt = require('bcryptjs');

class UserService {
  /**
   * 创建用户（包含业务验证）
   * @param {Object} userData - 用户数据
   * @param {number} operatorId - 操作者ID
   * @returns {Object} 新创建的用户
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
        account_expire_days = null,
        expire_at = null,
        remark = null
      } = userData;

      // 业务验证（邮箱非必填）
      await UserService.validateUserData({ email, username, password });

      // 如果提供了邮箱，检查是否已存在
      if (email) {
        const existingEmailUser = await User.findByEmail(email);
        if (existingEmailUser) {
          throw new ConflictError('该邮箱已被注册');
        }
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
        email: email ? email.toLowerCase() : null,
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
        username: newUser.username,
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
   * 批量创建用户（v1.1新增）
   * 从组积分池扣减积分，支持用户名规则生成
   * 
   * @param {Object} batchData - 批量创建数据
   * @param {number} batchData.group_id - 目标组ID
   * @param {string} batchData.username_prefix - 用户名前缀
   * @param {string} batchData.username_connector - 连接符（默认_）
   * @param {number} batchData.start_number - 起始序号
   * @param {number} batchData.number_digits - 序号位数（补零）
   * @param {number} batchData.count - 创建数量
   * @param {number} batchData.credits_per_user - 每用户积分
   * @param {string} batchData.password - 统一密码（可选，不填则随机生成）
   * @param {Object} currentUser - 当前操作用户
   * @returns {Object} 创建结果，包含用户列表和密码
   */
  static async batchCreateUsers(batchData, currentUser) {
    const {
      group_id,
      username_prefix,
      username_connector = '_',
      start_number = 1,
      number_digits = 3,
      count,
      credits_per_user = 0,
      password: customPassword
    } = batchData;

    // 参数验证
    if (!group_id) {
      throw new ValidationError('请选择目标用户组');
    }
    if (!username_prefix || username_prefix.trim() === '') {
      throw new ValidationError('用户名前缀不能为空');
    }
    if (!count || count < 1 || count > 500) {
      throw new ValidationError('创建数量必须在1-500之间');
    }
    if (credits_per_user < 0) {
      throw new ValidationError('每用户积分不能为负数');
    }

    // 验证用户名前缀格式（只允许字母、数字、下划线、横线）
    const prefixRegex = /^[a-zA-Z0-9_-]+$/;
    if (!prefixRegex.test(username_prefix)) {
      throw new ValidationError('用户名前缀只能包含字母、数字、下划线和横线');
    }

    // 权限检查
    if (currentUser.role === 'admin' && currentUser.group_id !== group_id) {
      throw new ValidationError('组管理员只能为本组创建用户');
    }

    // 获取组信息
    const group = await GroupService.findGroupById(group_id);
    if (!group) {
      throw new ValidationError('目标用户组不存在');
    }

    // 计算总需积分
    const totalCreditsNeeded = count * credits_per_user;

    // 检查组积分池余额（如果需要分配积分）
    if (totalCreditsNeeded > 0) {
      const poolRemaining = group.credits_pool - group.credits_pool_used;
      if (poolRemaining < totalCreditsNeeded) {
        throw new ValidationError(
          `组积分池余额不足，需要 ${totalCreditsNeeded} 积分，当前剩余 ${poolRemaining} 积分`
        );
      }
    }

    // 检查组容量
    const currentUserCount = await GroupService.getGroupUserCount(group_id);
    if (currentUserCount + count > group.user_limit) {
      throw new ValidationError(
        `组员数量将超过上限，当前 ${currentUserCount}/${group.user_limit}，无法再添加 ${count} 人`
      );
    }

    // 生成用户名列表并检查冲突
    const usernames = [];
    for (let i = 0; i < count; i++) {
      const num = start_number + i;
      const paddedNum = String(num).padStart(number_digits, '0');
      const username = `${username_prefix}${username_connector}${paddedNum}`;
      usernames.push(username);
    }

    // 检查用户名是否已存在
    const placeholders = usernames.map(() => '?').join(',');
    const checkSql = `SELECT username FROM users WHERE username IN (${placeholders}) AND deleted_at IS NULL`;
    const { rows: existingUsers } = await dbConnection.query(checkSql, usernames);
    
    if (existingUsers.length > 0) {
      const conflictNames = existingUsers.map(u => u.username).join(', ');
      throw new ValidationError(`以下用户名已存在: ${conflictNames}`);
    }

    // 获取系统默认token配额
    let defaultTokens = 10000;
    try {
      const systemSettings = await SystemConfig.getFormattedSettings();
      if (systemSettings.user?.default_tokens !== undefined) {
        defaultTokens = systemSettings.user.default_tokens;
      }
    } catch (e) {
      logger.warn('获取系统默认Token配置失败', { error: e.message });
    }

    // 生成密码（统一密码或随机密码）
    const useRandomPassword = !customPassword;
    const createdUsers = [];

    // 使用事务批量创建
    try {
      await dbConnection.transaction(async (query) => {
        // 1. 先扣减组积分池（加行锁）
        if (totalCreditsNeeded > 0) {
          const lockGroupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
          const { rows: lockedGroups } = await query(lockGroupSql, [group_id]);
          
          if (lockedGroups.length === 0) {
            throw new ValidationError('用户组不存在');
          }
          
          const lockedGroup = lockedGroups[0];
          const actualRemaining = lockedGroup.credits_pool - lockedGroup.credits_pool_used;
          
          if (actualRemaining < totalCreditsNeeded) {
            throw new ValidationError(
              `组积分池余额不足（并发检查），需要 ${totalCreditsNeeded}，剩余 ${actualRemaining}`
            );
          }

          // 扣减积分池
          const updatePoolSql = `
            UPDATE user_groups 
            SET credits_pool_used = credits_pool_used + ?, updated_at = NOW() 
            WHERE id = ?
          `;
          await query(updatePoolSql, [totalCreditsNeeded, group_id]);
        }

        // 2. 批量创建用户
        for (let i = 0; i < count; i++) {
          const username = usernames[i];
          
          // 生成密码
          let rawPassword;
          if (useRandomPassword) {
            // 生成8位随机密码（字母+数字）
            rawPassword = UserService.generateRandomPassword(8);
          } else {
            rawPassword = customPassword;
          }
          
          // 加密密码
          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(rawPassword, salt);
          
          // 生成UUID
          const uuid = UserService.generateUUID();
          
          // 计算有效期（同步组有效期）
          let expireAt = null;
          if (group.expire_date) {
            expireAt = group.expire_date;
          }

          // 插入用户
          const insertSql = `
            INSERT INTO users (
              uuid, uuid_source, username, password_hash, role, group_id, status,
              token_quota, credits_quota, used_tokens, used_credits,
              expire_at, created_at, updated_at
            ) VALUES (?, 'system', ?, ?, 'user', ?, 'active', ?, ?, 0, 0, ?, NOW(), NOW())
          `;
          
          const { rows: insertResult } = await query(insertSql, [
            uuid,
            username,
            passwordHash,
            group_id,
            defaultTokens,
            credits_per_user,
            expireAt
          ]);

          const newUserId = insertResult.insertId;

          // 记录积分流水（如果有分配积分）
          if (credits_per_user > 0) {
            const transactionSql = `
              INSERT INTO credit_transactions 
              (user_id, amount, balance_after, transaction_type, description, operator_id)
              VALUES (?, ?, ?, 'group_distribute', ?, ?)
            `;
            await query(transactionSql, [
              newUserId,
              credits_per_user,
              credits_per_user,
              '批量创建用户 - 初始积分分配',
              currentUser.id
            ]);
          }

          createdUsers.push({
            id: newUserId,
            username,
            password: rawPassword,
            credits: credits_per_user
          });
        }
      });

      logger.info('批量创建用户成功', {
        operatorId: currentUser.id,
        groupId: group_id,
        count: createdUsers.length,
        totalCreditsUsed: totalCreditsNeeded,
        usernamePrefix: username_prefix
      });

      return {
        success: true,
        message: `成功创建 ${createdUsers.length} 个用户`,
        created_count: createdUsers.length,
        total_credits_used: totalCreditsNeeded,
        users: createdUsers
      };

    } catch (error) {
      logger.error('批量创建用户失败（已回滚）', {
        error: error.message,
        operatorId: currentUser.id,
        groupId: group_id
      });
      throw error;
    }
  }

  /**
   * 生成随机密码
   * @param {number} length - 密码长度
   * @returns {string} 随机密码
   */
  static generateRandomPassword(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * 生成UUID
   * @returns {string} UUID字符串
   */
  static generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
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

      // 处理有效期更新
      if (updateData.expire_at !== undefined && operatorUser) {
        if (operatorUser.role === 'admin') {
          if (user.group_id !== operatorUser.group_id) {
            throw new ValidationError('无权设置其他组用户的有效期');
          }
          
          if (user.role === 'super_admin') {
            throw new ValidationError('组管理员无权设置超级管理员的有效期');
          }
          
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
        
        if (user.role === 'super_admin' && updateData.expire_at) {
          delete updateData.expire_at;
          logger.info('超级管理员账号不设置有效期，已忽略expire_at字段');
        }
      }

      // 检查是否有分组变更
      const isGroupChanged = updateData.group_id !== undefined && 
                           parseInt(updateData.group_id) !== parseInt(user.group_id);

      if (isGroupChanged) {
        const hasCapacity = await GroupService.checkGroupCapacity(updateData.group_id);
        if (!hasCapacity) {
          const group = await GroupService.findGroupById(updateData.group_id);
          const currentCount = await GroupService.getGroupUserCount(updateData.group_id);
          throw new ValidationError(`目标组已满员（${currentCount}/${group.user_limit}），无法加入`);
        }

        const userRemainingCredits = Math.max(0, user.credits_quota - user.used_credits);
        const originalGroupId = user.group_id;

        await dbConnection.transaction(async (query) => {
          if (originalGroupId !== 1 && userRemainingCredits > 0) {
            const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
            const { rows: groupRows } = await query(groupSql, [originalGroupId]);
            
            if (groupRows.length > 0) {
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

          let newExpireAt = null;
          if (user.role !== 'super_admin') {
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

          const finalUpdateData = {
            ...updateData,
            credits_quota: 0
          };

          if (newExpireAt !== null) {
            finalUpdateData.expire_at = newExpireAt;
          }

          const updateFields = Object.keys(finalUpdateData);
          const setClause = updateFields.map(field => `${field} = ?`).join(', ');
          const values = updateFields.map(field => finalUpdateData[field]);
          values.push(userId);

          const updateUserSql = `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
          await query(updateUserSql, values);

          if (userRemainingCredits > 0) {
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
              -userRemainingCredits,
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

        return await User.findById(userId);
      } else {
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
   * 删除用户（软删除）- 核心修改
   */
  static async deleteUser(userId, operatorId = null) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 调用User Model的软删除方法
      await user.softDelete();

      logger.info('用户软删除成功', {
        operatorId,
        deletedUserId: userId,
        deletedEmail: user.email,
        deletedUsername: user.username
      });

      return { 
        success: true, 
        message: '用户删除成功',
        deletedUser: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      };
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
        include_tags = false,
        sort_by = 'created_at',
        sort_order = 'DESC'
      } = filters;

      const result = await User.getList({
        page,
        limit,
        role,
        status,
        group_id,
        search,
        include_tags
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

      const result = await dbConnection.transaction(async (query) => {
        const placeholders = userIds.map(() => '?').join(',');
        const sql = `
          UPDATE users 
          SET status = ?, updated_at = NOW() 
          WHERE id IN (${placeholders}) AND deleted_at IS NULL
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
   * v1.1更新：邮箱改为非必填
   * @param {Object} data - 用户数据
   * @param {string} data.email - 邮箱（可选）
   * @param {string} data.username - 用户名（必填）
   * @param {string} data.password - 密码（必填）
   */
  static async validateUserData({ email, username, password }) {
    const errors = [];

    // 邮箱验证（非必填，但如果填了要验证格式）
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push('邮箱格式不正确');
      }
    }

    // 用户名验证（必填）
    if (!username) {
      errors.push('用户名不能为空');
    } else {
      const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
      if (!usernameRegex.test(username)) {
        errors.push('用户名只能包含字母、数字、下划线和横线，长度3-20个字符');
      }
    }

    // 密码验证（必填）
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

      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权查看其他组用户的模型权限');
      }

      const groupModels = await AIModel.getAvailableModelsByGroup(user.group_id);
      const restrictions = await AIModel.getUserModelRestrictions(userId);
      const restrictedModelIds = restrictions.map(r => r.id);

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

      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权管理其他组用户的模型权限');
      }

      const groupModels = await AIModel.getAvailableModelsByGroup(user.group_id);
      const groupModelIds = groupModels.map(m => m.id);

      const invalidModelIds = restrictedModelIds.filter(id => !groupModelIds.includes(id));
      if (invalidModelIds.length > 0) {
        throw new ValidationError('包含无效的模型ID：这些模型不在用户组的可用范围内');
      }

      if (restrictedModelIds.length === groupModels.length) {
        throw new ValidationError('不能限制用户使用所有模型，至少要保留一个可用模型');
      }

      await AIModel.updateUserModelRestrictions(userId, restrictedModelIds, operatorUser.id);

      logger.info('用户模型限制更新成功', {
        operatorId: operatorUser.id,
        userId,
        restrictedCount: restrictedModelIds.length,
        availableCount: groupModels.length - restrictedModelIds.length
      });

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

      if (user.group_id === 1) {
        throw new ValidationError('用户已在默认组，无需挪出');
      }

      if (operatorUser.role === 'admin') {
        if (user.group_id !== operatorUser.group_id) {
          throw new ValidationError('无权挪出其他组的用户');
        }
        if (user.id === operatorUser.id) {
          throw new ValidationError('不能将自己挪出组');
        }
      }

      if (user.role === 'super_admin' && operatorUser.role === 'super_admin') {
        throw new ValidationError('超级管理员之间不能互相挪出');
      }

      const userRemainingCredits = Math.max(0, user.credits_quota - user.used_credits);
      const originalGroupId = user.group_id;

      const result = await dbConnection.transaction(async (query) => {
        const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
        const { rows: groupRows } = await query(groupSql, [originalGroupId]);
        
        if (groupRows.length === 0) {
          throw new ValidationError('原组不存在');
        }
        
        const originalGroup = groupRows[0];

        let actualReturnedCredits = 0;
        if (originalGroupId !== 1 && userRemainingCredits > 0) {
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

        let updateUserSql = `
          UPDATE users 
          SET group_id = 1, 
              credits_quota = 0,
              updated_at = NOW() 
          WHERE id = ? AND deleted_at IS NULL
        `;
        
        if (user.role !== 'super_admin') {
          updateUserSql = `
            UPDATE users 
            SET group_id = 1, 
                credits_quota = 0,
                expire_at = NULL,
                updated_at = NOW() 
            WHERE id = ? AND deleted_at IS NULL
          `;
        }
        
        await query(updateUserSql, [userId]);

        if (userRemainingCredits > 0) {
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
            -userRemainingCredits,
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
   * 设置用户账号有效期
   */
  static async setUserAccountExpireDate(userId, expireDate, reason = '管理员设置', operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权设置其他组用户的有效期');
      }

      if (operatorUser.role === 'admin' && user.role === 'super_admin') {
        throw new ValidationError('组管理员无权设置超级管理员的有效期');
      }

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
   * 延长用户账号有效期
   */
  static async extendUserAccountExpireDate(userId, days, reason = '管理员延期', operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权延长其他组用户的有效期');
      }

      if (operatorUser.role === 'admin' && user.role === 'super_admin') {
        throw new ValidationError('组管理员无权延长超级管理员的有效期');
      }

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
   * 同步用户有效期到组有效期
   */
  static async syncUserAccountExpireWithGroup(userId, operatorUser) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      if (operatorUser.role === 'admin' && user.group_id !== operatorUser.group_id) {
        throw new ValidationError('无权同步其他组用户的有效期');
      }

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
