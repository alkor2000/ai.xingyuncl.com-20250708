/**
 * 用户分组服务层 - 处理用户分组相关的业务逻辑（包含积分池功能、组员上限、组有效期和站点配置）
 */

const User = require('../../models/User');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');

class GroupService {
  /**
   * 获取用户分组列表（包含积分池信息、有效期和站点配置）
   */
  static async getGroups(currentUser = null) {
    try {
      let groups;

      if (currentUser && currentUser.role === 'admin' && currentUser.group_id) {
        // 管理员只能看到自己所在的组
        const sql = `
          SELECT g.*, 
                 COUNT(u.id) as user_count,
                 AVG(u.used_tokens) as avg_tokens_used,
                 AVG(u.used_credits) as avg_credits_used,
                 SUM(u.credits_quota - u.used_credits) as total_credits_balance,
                 g.credits_pool,
                 g.credits_pool_used,
                 g.user_limit,
                 (g.credits_pool - g.credits_pool_used) as credits_pool_remaining,
                 g.expire_date,
                 CASE 
                   WHEN g.expire_date IS NULL THEN 0
                   WHEN g.expire_date < CURDATE() THEN 1
                   ELSE 0
                 END as is_expired,
                 CASE
                   WHEN g.expire_date IS NULL THEN NULL
                   ELSE DATEDIFF(g.expire_date, CURDATE())
                 END as remaining_days,
                 g.site_customization_enabled,
                 g.site_name,
                 g.site_logo
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
          WHERE g.id = ?
          GROUP BY g.id
        `;
        const { rows } = await dbConnection.query(sql, [currentUser.group_id]);
        groups = rows;
      } else {
        // 超级管理员可以看到所有组
        const sql = `
          SELECT g.*, 
                 COUNT(u.id) as user_count,
                 AVG(u.used_tokens) as avg_tokens_used,
                 AVG(u.used_credits) as avg_credits_used,
                 SUM(u.credits_quota - u.used_credits) as total_credits_balance,
                 g.credits_pool,
                 g.credits_pool_used,
                 g.user_limit,
                 (g.credits_pool - g.credits_pool_used) as credits_pool_remaining,
                 g.expire_date,
                 CASE 
                   WHEN g.expire_date IS NULL THEN 0
                   WHEN g.expire_date < CURDATE() THEN 1
                   ELSE 0
                 END as is_expired,
                 CASE
                   WHEN g.expire_date IS NULL THEN NULL
                   ELSE DATEDIFF(g.expire_date, CURDATE())
                 END as remaining_days,
                 g.site_customization_enabled,
                 g.site_name,
                 g.site_logo
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
          GROUP BY g.id
          ORDER BY g.sort_order ASC, g.created_at ASC
        `;
        const { rows } = await dbConnection.query(sql);
        groups = rows;
      }

      return groups;
    } catch (error) {
      logger.error('获取用户分组列表失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 创建用户分组 - 自动分配所有激活的AI模型权限
   */
  static async createGroup(groupData, operatorId = null) {
    try {
      const { name, description, color, permissions = [], is_active = true, expire_date = null } = groupData;

      // 验证必填字段
      if (!name) {
        throw new ValidationError('分组名称不能为空');
      }

      // 检查分组名称是否已存在
      const existingGroup = await GroupService.findGroupByName(name);
      if (existingGroup) {
        throw new ConflictError('分组名称已存在');
      }

      // 使用事务确保原子性 - 创建组和分配AI模型权限
      const result = await dbConnection.transaction(async (query) => {
        // 1. 创建分组
        const group = await User.createGroup({
          name,
          description,
          color,
          permissions,
          is_active,
          expire_date
        }, operatorId);

        // 2. 获取所有激活的AI模型（对话模型）
        const aiModelsSql = 'SELECT id, name, display_name FROM ai_models WHERE is_active = 1';
        const { rows: aiModels } = await query(aiModelsSql);

        // 3. 获取所有激活的图像模型
        const imageModelsSql = 'SELECT id, name, display_name FROM image_models WHERE is_active = 1';
        const { rows: imageModels } = await query(imageModelsSql);

        // 4. 自动分配所有AI对话模型给新创建的组
        if (aiModels.length > 0) {
          const aiModelAssignments = aiModels.map(model => [model.id, group.id, operatorId]);
          const aiAssignSql = 'INSERT INTO ai_model_groups (model_id, group_id, created_by) VALUES ?';
          
          // MySQL的批量插入语法
          const aiInsertSql = `
            INSERT INTO ai_model_groups (model_id, group_id, created_by) 
            VALUES ${aiModelAssignments.map(() => '(?, ?, ?)').join(', ')}
          `;
          const aiInsertParams = aiModelAssignments.flat();
          await query(aiInsertSql, aiInsertParams);

          logger.info('自动分配AI对话模型给新组成功', {
            groupId: group.id,
            groupName: group.name,
            assignedAIModels: aiModels.length,
            modelNames: aiModels.map(m => m.display_name).join(', ')
          });
        }

        // 5. 记录图像模型数量（当前系统架构下图像模型权限可能通过其他机制管理）
        if (imageModels.length > 0) {
          logger.info('系统中存在激活的图像模型', {
            groupId: group.id,
            groupName: group.name,
            imageModelCount: imageModels.length,
            imageModelNames: imageModels.map(m => m.display_name).join(', '),
            note: '图像模型权限管理机制待确认'
          });
        }

        return {
          group,
          assignedAIModels: aiModels.length,
          totalImageModels: imageModels.length
        };
      });

      logger.info('创建用户分组成功（包含模型权限自动分配）', {
        operatorId,
        groupId: result.group.id,
        groupName: result.group.name,
        expireDate: result.group.expire_date,
        assignedAIModels: result.assignedAIModels,
        totalImageModels: result.totalImageModels
      });

      return result.group;
    } catch (error) {
      logger.error('创建用户分组失败', { error: error.message, groupData });
      throw error;
    }
  }

  /**
   * 更新用户分组
   */
  static async updateGroup(groupId, updateData, operatorId = null) {
    try {
      // 先检查分组是否存在
      const currentGroup = await GroupService.findGroupById(groupId);
      if (!currentGroup) {
        throw new ValidationError('用户分组不存在');
      }

      // 如果要更新分组名称，检查是否与其他分组重复
      if (updateData.name && updateData.name !== currentGroup.name) {
        const existingGroup = await GroupService.findGroupByName(updateData.name);
        // 使用宽松比较或转换类型，避免字符串和数字比较问题
        if (existingGroup && String(existingGroup.id) !== String(groupId)) {
          throw new ConflictError('分组名称已存在');
        }
      }

      // 执行更新
      const group = await User.updateGroup(groupId, updateData);

      logger.info('更新用户分组成功', {
        operatorId,
        groupId,
        updateFields: Object.keys(updateData)
      });

      return group;
    } catch (error) {
      logger.error('更新用户分组失败', { error: error.message, groupId, updateData });
      throw error;
    }
  }

  /**
   * 删除用户分组
   */
  static async deleteGroup(groupId, operatorId = null) {
    try {
      // 检查分组下是否还有用户
      const userCount = await GroupService.getGroupUserCount(groupId);
      if (userCount > 0) {
        throw new ValidationError(`该分组下还有${userCount}个用户，无法删除`);
      }

      await User.deleteGroup(groupId);

      logger.info('删除用户分组成功', {
        operatorId,
        deletedGroupId: groupId
      });

      return { success: true, message: '用户分组删除成功' };
    } catch (error) {
      logger.error('删除用户分组失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 设置组积分池
   */
  static async setGroupCreditsPool(groupId, creditsPool, operatorId = null) {
    try {
      if (typeof creditsPool !== 'number' || creditsPool < 0) {
        throw new ValidationError('积分池额度必须是非负数');
      }

      // 获取当前组信息
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 如果减少积分池，确保不低于已使用额度
      if (creditsPool < group.credits_pool_used) {
        throw new ValidationError(`积分池额度不能低于已使用额度(${group.credits_pool_used})`);
      }

      // 更新积分池
      const sql = 'UPDATE user_groups SET credits_pool = ?, updated_at = NOW() WHERE id = ?';
      await dbConnection.query(sql, [creditsPool, groupId]);

      logger.info('设置组积分池成功', {
        operatorId,
        groupId,
        creditsPool,
        oldCreditsPool: group.credits_pool
      });

      return {
        success: true,
        credits_pool: creditsPool,
        credits_pool_used: group.credits_pool_used,
        credits_pool_remaining: creditsPool - group.credits_pool_used
      };
    } catch (error) {
      logger.error('设置组积分池失败', { error: error.message, groupId, creditsPool });
      throw error;
    }
  }

  /**
   * 从组积分池分配积分给用户
   */
  static async distributeCreditsFromPool(groupId, userId, amount, reason, distributorId) {
    try {
      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('分配金额必须是正数');
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 1. 获取组信息并锁定
        const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
        const { rows: groupRows } = await query(groupSql, [groupId]);
        
        if (groupRows.length === 0) {
          throw new ValidationError('用户分组不存在');
        }
        
        const group = groupRows[0];
        const remaining = group.credits_pool - group.credits_pool_used;
        
        if (remaining < amount) {
          throw new ValidationError(`组积分池余额不足，剩余: ${remaining}，需要: ${amount}`);
        }

        // 2. 更新组积分池已使用额度
        const updateGroupSql = `
          UPDATE user_groups 
          SET credits_pool_used = credits_pool_used + ?, 
              updated_at = NOW() 
          WHERE id = ?
        `;
        await query(updateGroupSql, [amount, groupId]);

        // 3. 获取用户信息
        const userSql = 'SELECT * FROM users WHERE id = ?';
        const { rows: userRows } = await query(userSql, [userId]);
        
        if (userRows.length === 0) {
          throw new ValidationError('用户不存在');
        }
        
        const user = userRows[0];
        
        // 检查用户是否属于该组
        if (user.group_id !== groupId) {
          throw new ValidationError('用户不属于该分组');
        }

        // 4. 更新用户积分
        const oldQuota = user.credits_quota || 0;
        const newQuota = oldQuota + amount;
        
        const updateUserSql = `
          UPDATE users 
          SET credits_quota = ?, updated_at = NOW()
          WHERE id = ?
        `;
        await query(updateUserSql, [newQuota, userId]);

        // 5. 记录交易历史
        const transactionSql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id, distributor_id)
          VALUES (?, ?, ?, 'group_distribute', ?, ?, ?)
        `;
        await query(transactionSql, [
          userId,
          amount,
          newQuota - (user.used_credits || 0),
          reason || '组内积分分配',
          distributorId,
          distributorId
        ]);

        return {
          credits_pool_remaining: group.credits_pool - group.credits_pool_used - amount,
          user_new_balance: newQuota - (user.used_credits || 0)
        };
      });

      logger.info('组积分池分配成功', {
        distributorId,
        groupId,
        userId,
        amount,
        reason,
        result
      });

      return {
        success: true,
        amount,
        ...result,
        message: '积分分配成功'
      };
    } catch (error) {
      logger.error('组积分池分配失败', { error: error.message, groupId, userId, amount });
      throw error;
    }
  }

  /**
   * 从用户回收积分到组积分池
   */
  static async recycleCreditsToPool(groupId, userId, amount, reason, operatorId) {
    try {
      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('回收金额必须是正数');
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 1. 获取组信息并锁定
        const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
        const { rows: groupRows } = await query(groupSql, [groupId]);
        
        if (groupRows.length === 0) {
          throw new ValidationError('用户分组不存在');
        }
        
        const group = groupRows[0];

        // 2. 获取用户信息并锁定
        const userSql = 'SELECT * FROM users WHERE id = ? FOR UPDATE';
        const { rows: userRows } = await query(userSql, [userId]);
        
        if (userRows.length === 0) {
          throw new ValidationError('用户不存在');
        }
        
        const user = userRows[0];
        
        // 检查用户是否属于该组
        if (user.group_id !== groupId) {
          throw new ValidationError('用户不属于该分组');
        }

        // 检查用户可用积分
        const userAvailable = (user.credits_quota || 0) - (user.used_credits || 0);
        if (userAvailable < amount) {
          throw new ValidationError(`用户积分不足，可用余额: ${userAvailable}，需要回收: ${amount}`);
        }

        // 3. 更新组积分池已使用额度（减少）
        const updateGroupSql = `
          UPDATE user_groups 
          SET credits_pool_used = GREATEST(0, credits_pool_used - ?), 
              updated_at = NOW() 
          WHERE id = ?
        `;
        await query(updateGroupSql, [amount, groupId]);

        // 4. 更新用户积分（减少）
        const newQuota = user.credits_quota - amount;
        
        const updateUserSql = `
          UPDATE users 
          SET credits_quota = ?, updated_at = NOW()
          WHERE id = ?
        `;
        await query(updateUserSql, [newQuota, userId]);

        // 5. 记录交易历史（负数表示扣减）
        const transactionSql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id, distributor_id)
          VALUES (?, ?, ?, 'group_recycle', ?, ?, ?)
        `;
        await query(transactionSql, [
          userId,
          -amount, // 负数表示扣减
          newQuota - (user.used_credits || 0),
          reason || '组积分池回收',
          operatorId,
          operatorId
        ]);

        // 获取更新后的组信息
        const updatedGroupSql = 'SELECT credits_pool, credits_pool_used FROM user_groups WHERE id = ?';
        const { rows: updatedGroupRows } = await query(updatedGroupSql, [groupId]);
        const updatedGroup = updatedGroupRows[0];

        return {
          credits_pool_remaining: updatedGroup.credits_pool - updatedGroup.credits_pool_used,
          user_new_balance: newQuota - (user.used_credits || 0)
        };
      });

      logger.info('组积分池回收成功', {
        operatorId,
        groupId,
        userId,
        amount,
        reason,
        result
      });

      return {
        success: true,
        amount,
        ...result,
        message: '积分回收成功'
      };
    } catch (error) {
      logger.error('组积分池回收失败', { error: error.message, groupId, userId, amount });
      throw error;
    }
  }

  /**
   * 根据名称查找分组
   */
  static async findGroupByName(name) {
    try {
      const sql = 'SELECT * FROM user_groups WHERE name = ?';
      const { rows } = await dbConnection.query(sql, [name]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error('根据名称查找分组失败', { error: error.message, name });
      throw error;
    }
  }

  /**
   * 获取分组用户数量
   */
  static async getGroupUserCount(groupId) {
    try {
      const sql = 'SELECT COUNT(*) as count FROM users WHERE group_id = ? AND status != ?';
      const { rows } = await dbConnection.query(sql, [groupId, 'deleted']);
      return rows[0].count;
    } catch (error) {
      logger.error('获取分组用户数量失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 批量移动用户到新分组
   */
  static async moveUsersToGroup(userIds, targetGroupId, operatorId = null) {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new ValidationError('用户ID列表不能为空');
      }

      // 检查目标分组是否存在
      const targetGroup = await GroupService.findGroupById(targetGroupId);
      if (!targetGroup) {
        throw new ValidationError('目标分组不存在');
      }

      // 检查目标组容量
      const hasCapacity = await GroupService.checkGroupCapacity(targetGroupId, userIds.length);
      if (!hasCapacity) {
        const currentCount = await GroupService.getGroupUserCount(targetGroupId);
        throw new ValidationError(`目标组已满员，当前 ${currentCount}/${targetGroup.user_limit}`);
      }

      // 使用事务批量更新（包括同步有效期）
      const result = await dbConnection.transaction(async (query) => {
        // 如果目标组有有效期设置，同步到用户
        let updateSql;
        let params;
        
        if (targetGroup.expire_date) {
          const placeholders = userIds.map(() => '?').join(',');
          updateSql = `
            UPDATE users 
            SET group_id = ?, expire_at = ?, updated_at = NOW() 
            WHERE id IN (${placeholders}) AND status != 'deleted' AND role != 'super_admin'
          `;
          params = [targetGroupId, targetGroup.expire_date, ...userIds];
        } else {
          const placeholders = userIds.map(() => '?').join(',');
          updateSql = `
            UPDATE users 
            SET group_id = ?, updated_at = NOW() 
            WHERE id IN (${placeholders}) AND status != 'deleted'
          `;
          params = [targetGroupId, ...userIds];
        }
        
        const { rows } = await query(updateSql, params);
        return rows.affectedRows;
      });

      logger.info('批量移动用户到新分组成功', {
        operatorId,
        userIds,
        targetGroupId,
        affectedCount: result,
        syncedExpireDate: targetGroup.expire_date
      });

      return {
        success: true,
        affectedCount: result,
        message: `成功移动${result}个用户到新分组`
      };
    } catch (error) {
      logger.error('批量移动用户失败', { error: error.message, userIds, targetGroupId });
      throw error;
    }
  }

  /**
   * 根据ID查找分组（包含积分池信息、有效期和站点配置）
   */
  static async findGroupById(groupId) {
    try {
      const sql = 'SELECT * FROM user_groups WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [groupId]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error('根据ID查找分组失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 获取分组统计信息
   */
  static async getGroupStats(groupId) {
    try {
      const sql = `
        SELECT 
          g.*,
          COUNT(DISTINCT u.id) as user_count,
          SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) as active_users,
          SUM(u.used_tokens) as total_tokens_used,
          AVG(u.used_tokens) as avg_tokens_per_user,
          SUM(u.credits_quota) as total_credits_quota,
          SUM(u.used_credits) as total_credits_used,
          SUM(u.credits_quota - u.used_credits) as total_credits_balance,
          AVG(u.credits_quota - u.used_credits) as avg_credits_balance,
          g.credits_pool,
          g.credits_pool_used,
          (g.credits_pool - g.credits_pool_used) as credits_pool_remaining,
          g.user_limit,
          g.expire_date,
          CASE 
            WHEN g.expire_date IS NULL THEN 0
            WHEN g.expire_date < CURDATE() THEN 1
            ELSE 0
          END as is_expired,
          CASE
            WHEN g.expire_date IS NULL THEN NULL
            ELSE DATEDIFF(g.expire_date, CURDATE())
          END as remaining_days,
          g.site_customization_enabled,
          g.site_name,
          g.site_logo
        FROM user_groups g
        LEFT JOIN users u ON g.id = u.group_id
        WHERE g.id = ?
        GROUP BY g.id
      `;
      
      const { rows } = await dbConnection.query(sql, [groupId]);
      
      if (rows.length === 0) {
        throw new ValidationError('分组不存在');
      }

      return rows[0];
    } catch (error) {
      logger.error('获取分组统计信息失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 检查组是否还有容量
   */
  static async checkGroupCapacity(groupId, additionalCount = 1) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      const currentCount = await GroupService.getGroupUserCount(groupId);
      const newCount = currentCount + additionalCount;

      return newCount <= group.user_limit;
    } catch (error) {
      logger.error('检查组容量失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 设置组员上限
   */
  static async setGroupUserLimit(groupId, userLimit, operatorId = null) {
    try {
      if (typeof userLimit !== 'number' || userLimit < 1) {
        throw new ValidationError('组员上限必须是大于0的数字');
      }

      // 获取当前组信息
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 获取当前组员数
      const currentCount = await GroupService.getGroupUserCount(groupId);
      
      // 不能低于当前组员数
      if (userLimit < currentCount) {
        throw new ValidationError(`组员上限不能低于当前组员数(${currentCount}人)`);
      }

      // 更新组员上限
      const sql = 'UPDATE user_groups SET user_limit = ?, updated_at = NOW() WHERE id = ?';
      await dbConnection.query(sql, [userLimit, groupId]);

      logger.info('设置组员上限成功', {
        operatorId,
        groupId,
        userLimit,
        oldUserLimit: group.user_limit,
        currentCount
      });

      return {
        success: true,
        user_limit: userLimit,
        user_count: currentCount,
        available_slots: userLimit - currentCount
      };
    } catch (error) {
      logger.error('设置组员上限失败', { error: error.message, groupId, userLimit });
      throw error;
    }
  }

  /**
   * 设置组有效期（新增）
   */
  static async setGroupExpireDate(groupId, expireDate, syncToUsers = false, operatorId = null) {
    try {
      // 获取当前组信息
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 使用事务确保原子性
      await dbConnection.transaction(async (query) => {
        // 1. 更新组有效期
        const updateGroupSql = 'UPDATE user_groups SET expire_date = ?, updated_at = NOW() WHERE id = ?';
        await query(updateGroupSql, [expireDate, groupId]);

        // 2. 如果需要同步到用户
        if (syncToUsers) {
          const updateUsersSql = `
            UPDATE users 
            SET expire_at = ?, updated_at = NOW() 
            WHERE group_id = ? AND role != 'super_admin'
          `;
          await query(updateUsersSql, [expireDate, groupId]);

          logger.info('同步组有效期到所有组员', {
            groupId,
            expireDate
          });
        }
      });

      logger.info('设置组有效期成功', {
        operatorId,
        groupId,
        expireDate,
        oldExpireDate: group.expire_date,
        syncToUsers
      });

      return {
        success: true,
        expire_date: expireDate,
        synced_to_users: syncToUsers,
        message: '组有效期设置成功'
      };
    } catch (error) {
      logger.error('设置组有效期失败', { error: error.message, groupId, expireDate });
      throw error;
    }
  }

  /**
   * 同步组有效期到所有组员（新增）
   */
  static async syncGroupExpireDateToUsers(groupId, operatorId = null) {
    try {
      // 获取组信息
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      if (!group.expire_date) {
        throw new ValidationError('该组未设置有效期');
      }

      // 更新所有组员的有效期（排除超管）
      const sql = `
        UPDATE users 
        SET expire_at = ?, updated_at = NOW() 
        WHERE group_id = ? AND role != 'super_admin'
      `;
      const { rows } = await dbConnection.query(sql, [group.expire_date, groupId]);
      const affectedCount = rows.affectedRows;

      logger.info('同步组有效期到组员成功', {
        operatorId,
        groupId,
        expireDate: group.expire_date,
        affectedCount
      });

      return {
        success: true,
        expire_date: group.expire_date,
        affected_users: affectedCount,
        message: `成功同步有效期到${affectedCount}个用户`
      };
    } catch (error) {
      logger.error('同步组有效期失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 克隆分组配置 - 包含自动分配AI模型权限
   */
  static async cloneGroup(sourceGroupId, newGroupName, operatorId = null) {
    try {
      const sourceGroup = await GroupService.findGroupById(sourceGroupId);
      if (!sourceGroup) {
        throw new ValidationError('源分组不存在');
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 1. 创建新分组（包含有效期）- 这会自动分配所有激活的AI模型
        const newGroup = await GroupService.createGroup({
          name: newGroupName,
          description: `克隆自: ${sourceGroup.name}`,
          color: sourceGroup.color,
          permissions: sourceGroup.permissions,
          is_active: true,
          expire_date: sourceGroup.expire_date
        }, operatorId);

        // 2. 克隆源组的AI模型分配关系（如果源组有特定的模型配置）
        const sourceModelAssignmentsSql = 'SELECT model_id FROM ai_model_groups WHERE group_id = ?';
        const { rows: sourceModels } = await query(sourceModelAssignmentsSql, [sourceGroupId]);

        if (sourceModels.length > 0) {
          // 删除自动分配的模型，改为复制源组的模型配置
          const deleteAutoAssignedSql = 'DELETE FROM ai_model_groups WHERE group_id = ?';
          await query(deleteAutoAssignedSql, [newGroup.id]);

          // 复制源组的模型分配
          const cloneAssignments = sourceModels.map(model => [model.model_id, newGroup.id, operatorId]);
          const cloneSql = `
            INSERT INTO ai_model_groups (model_id, group_id, created_by) 
            VALUES ${cloneAssignments.map(() => '(?, ?, ?)').join(', ')}
          `;
          const cloneParams = cloneAssignments.flat();
          await query(cloneSql, cloneParams);

          logger.info('克隆分组AI模型分配成功', {
            sourceGroupId,
            newGroupId: newGroup.id,
            clonedModels: sourceModels.length
          });
        }

        return newGroup;
      });

      logger.info('克隆分组成功', {
        operatorId,
        sourceGroupId,
        newGroupId: result.id,
        newGroupName
      });

      return result;
    } catch (error) {
      logger.error('克隆分组失败', { error: error.message, sourceGroupId, newGroupName });
      throw error;
    }
  }

  /**
   * 设置组站点自定义（仅超级管理员）
   */
  static async toggleGroupSiteCustomization(groupId, enabled, operatorId = null) {
    try {
      // 获取当前组信息
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 更新站点自定义开关
      const sql = 'UPDATE user_groups SET site_customization_enabled = ?, updated_at = NOW() WHERE id = ?';
      await dbConnection.query(sql, [enabled ? 1 : 0, groupId]);

      logger.info('设置组站点自定义开关成功', {
        operatorId,
        groupId,
        enabled,
        oldValue: group.site_customization_enabled
      });

      return {
        success: true,
        site_customization_enabled: enabled,
        message: enabled ? '已开启站点自定义功能' : '已关闭站点自定义功能'
      };
    } catch (error) {
      logger.error('设置组站点自定义开关失败', { error: error.message, groupId, enabled });
      throw error;
    }
  }

  /**
   * 更新组站点配置（组管理员）
   */
  static async updateGroupSiteConfig(groupId, siteConfig, operatorId = null) {
    try {
      // 获取当前组信息
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 检查是否允许自定义
      if (!group.site_customization_enabled) {
        throw new ValidationError('该组未开启站点自定义功能');
      }

      const { site_name, site_logo } = siteConfig;

      // 更新站点配置
      const sql = `
        UPDATE user_groups 
        SET site_name = ?, site_logo = ?, updated_at = NOW() 
        WHERE id = ? AND site_customization_enabled = 1
      `;
      const { rows } = await dbConnection.query(sql, [site_name || null, site_logo || null, groupId]);

      if (rows.affectedRows === 0) {
        throw new ValidationError('更新失败，请确认该组已开启站点自定义功能');
      }

      logger.info('更新组站点配置成功', {
        operatorId,
        groupId,
        siteName: site_name,
        siteLogo: site_logo
      });

      return {
        success: true,
        site_name,
        site_logo,
        message: '站点配置更新成功'
      };
    } catch (error) {
      logger.error('更新组站点配置失败', { error: error.message, groupId, siteConfig });
      throw error;
    }
  }

  /**
   * 获取组站点配置（根据用户获取）
   */
  static async getGroupSiteConfig(groupId) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        return null;
      }

      // 如果组开启了自定义且有配置
      if (group.site_customization_enabled && (group.site_name || group.site_logo)) {
        return {
          site_name: group.site_name,
          site_logo: group.site_logo,
          is_group_config: true
        };
      }

      return null;
    } catch (error) {
      logger.error('获取组站点配置失败', { error: error.message, groupId });
      return null;
    }
  }

  /**
   * 为现有组补充分配AI模型权限（管理员工具方法）
   */
  static async assignAllActiveModelsToGroup(groupId, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 1. 获取所有激活的AI模型
        const aiModelsSql = 'SELECT id, name, display_name FROM ai_models WHERE is_active = 1';
        const { rows: aiModels } = await query(aiModelsSql);

        if (aiModels.length === 0) {
          return { assignedCount: 0 };
        }

        // 2. 获取该组已分配的模型
        const existingAssignmentsSql = 'SELECT model_id FROM ai_model_groups WHERE group_id = ?';
        const { rows: existingAssignments } = await query(existingAssignmentsSql, [groupId]);
        const existingModelIds = new Set(existingAssignments.map(a => a.model_id));

        // 3. 找出需要新分配的模型
        const newModels = aiModels.filter(model => !existingModelIds.has(model.id));

        if (newModels.length === 0) {
          return { assignedCount: 0, message: '该组已分配了所有激活的AI模型' };
        }

        // 4. 分配新的模型
        const newAssignments = newModels.map(model => [model.id, groupId, operatorId]);
        const insertSql = `
          INSERT INTO ai_model_groups (model_id, group_id, created_by) 
          VALUES ${newAssignments.map(() => '(?, ?, ?)').join(', ')}
        `;
        const insertParams = newAssignments.flat();
        await query(insertSql, insertParams);

        logger.info('为现有组补充分配AI模型成功', {
          groupId,
          groupName: group.name,
          newAssignedModels: newModels.length,
          modelNames: newModels.map(m => m.display_name).join(', ')
        });

        return {
          assignedCount: newModels.length,
          assignedModels: newModels
        };
      });

      return {
        success: true,
        ...result,
        message: result.assignedCount > 0 
          ? `成功为组"${group.name}"分配了${result.assignedCount}个AI模型` 
          : '该组已分配了所有激活的AI模型'
      };
    } catch (error) {
      logger.error('为现有组补充分配AI模型失败', { error: error.message, groupId });
      throw error;
    }
  }
}

module.exports = GroupService;
