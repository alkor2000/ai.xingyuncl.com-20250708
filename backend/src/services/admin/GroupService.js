/**
 * 用户分组服务层 - 处理用户分组相关的业务逻辑
 * 包含：积分池功能、组员上限、组有效期、站点配置、邀请码功能、组公告功能
 * 
 * 修复记录：
 * - getGroupUserCount: 改用deleted_at IS NULL过滤已删除用户
 * - 新增 getGroupAnnouncement / updateGroupAnnouncement 组公告方法
 */

const User = require('../../models/User');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');

class GroupService {
  /**
   * 获取用户分组列表（包含积分池信息、有效期、站点配置和邀请码信息）
   */
  static async getGroups(currentUser = null) {
    try {
      let groups;

      if (currentUser && currentUser.role === 'admin' && currentUser.group_id) {
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
                 g.site_logo,
                 g.invitation_enabled,
                 g.invitation_code,
                 g.invitation_usage_count,
                 g.invitation_max_uses,
                 g.invitation_expire_at
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active' AND u.deleted_at IS NULL
          WHERE g.id = ?
          GROUP BY g.id
        `;
        const { rows } = await dbConnection.query(sql, [currentUser.group_id]);
        groups = rows;
      } else {
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
                 g.site_logo,
                 g.invitation_enabled,
                 g.invitation_code,
                 g.invitation_usage_count,
                 g.invitation_max_uses,
                 g.invitation_expire_at
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active' AND u.deleted_at IS NULL
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

  static async createGroup(groupData, operatorId = null) {
    try {
      const { name, description, color, permissions = [], is_active = true, expire_date = null } = groupData;

      if (!name) {
        throw new ValidationError('分组名称不能为空');
      }

      const existingGroup = await GroupService.findGroupByName(name);
      if (existingGroup) {
        throw new ConflictError('分组名称已存在');
      }

      const result = await dbConnection.transaction(async (query) => {
        const group = await User.createGroup({
          name,
          description,
          color,
          permissions,
          is_active,
          expire_date
        }, operatorId);

        const aiModelsSql = 'SELECT id, name, display_name FROM ai_models WHERE is_active = 1';
        const { rows: aiModels } = await query(aiModelsSql);

        const imageModelsSql = 'SELECT id, name, display_name FROM image_models WHERE is_active = 1';
        const { rows: imageModels } = await query(imageModelsSql);

        if (aiModels.length > 0) {
          const aiModelAssignments = aiModels.map(model => [model.id, group.id, operatorId]);
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

  static async updateGroup(groupId, updateData, operatorId = null) {
    try {
      const currentGroup = await GroupService.findGroupById(groupId);
      if (!currentGroup) {
        throw new ValidationError('用户分组不存在');
      }

      if (updateData.name && updateData.name !== currentGroup.name) {
        const existingGroup = await GroupService.findGroupByName(updateData.name);
        if (existingGroup && String(existingGroup.id) !== String(groupId)) {
          throw new ConflictError('分组名称已存在');
        }
      }

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

  static async deleteGroup(groupId, operatorId = null) {
    try {
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

  static async setGroupInvitationCode(groupId, invitationData, operatorId = null) {
    try {
      const { 
        enabled, 
        code, 
        max_uses = null, 
        expire_at = null 
      } = invitationData;

      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      await dbConnection.transaction(async (query) => {
        if (enabled) {
          if (!code) {
            throw new ValidationError('请输入邀请码');
          }

          if (!/^[A-Za-z0-9]{5}$/.test(code)) {
            throw new ValidationError('邀请码必须是5位英文或数字');
          }

          const existingCodeSql = `
            SELECT id, name FROM user_groups 
            WHERE invitation_code = ? AND id != ?
          `;
          const { rows: existingGroups } = await query(existingCodeSql, [code.toUpperCase(), groupId]);
          
          if (existingGroups.length > 0) {
            throw new ConflictError(`邀请码已被"${existingGroups[0].name}"使用`);
          }

          const updateSql = `
            UPDATE user_groups 
            SET invitation_enabled = 1,
                invitation_code = ?,
                invitation_usage_count = CASE 
                  WHEN invitation_code = ? THEN invitation_usage_count 
                  ELSE 0 
                END,
                invitation_max_uses = ?,
                invitation_expire_at = ?,
                updated_at = NOW()
            WHERE id = ?
          `;
          await query(updateSql, [
            code.toUpperCase(),
            code.toUpperCase(),
            max_uses,
            expire_at,
            groupId
          ]);

          logger.info('设置组邀请码成功', {
            operatorId,
            groupId,
            code: code.toUpperCase(),
            maxUses: max_uses,
            expireAt: expire_at
          });
        } else {
          const updateSql = `
            UPDATE user_groups 
            SET invitation_enabled = 0,
                updated_at = NOW()
            WHERE id = ?
          `;
          await query(updateSql, [groupId]);

          logger.info('禁用组邀请码', {
            operatorId,
            groupId
          });
        }
      });

      return {
        success: true,
        message: enabled ? '邀请码设置成功' : '邀请码已禁用'
      };
    } catch (error) {
      logger.error('设置组邀请码失败', { error: error.message, groupId, invitationData });
      throw error;
    }
  }

  static async findGroupByInvitationCode(code) {
    try {
      if (!code) {
        return null;
      }

      const sql = `
        SELECT * FROM user_groups 
        WHERE invitation_code = ? 
          AND invitation_enabled = 1
          AND is_active = 1
          AND (invitation_expire_at IS NULL OR invitation_expire_at > NOW())
          AND (invitation_max_uses IS NULL OR invitation_usage_count < invitation_max_uses)
      `;
      const { rows } = await dbConnection.query(sql, [code.toUpperCase()]);
      
      if (rows.length === 0) {
        return null;
      }

      const group = rows[0];

      const hasCapacity = await GroupService.checkGroupCapacity(group.id, 1);
      if (!hasCapacity) {
        logger.warn('邀请码对应的组已满员', { 
          code, 
          groupId: group.id,
          groupName: group.name 
        });
        return null;
      }

      return group;
    } catch (error) {
      logger.error('根据邀请码查找组失败', { error: error.message, code });
      throw error;
    }
  }

  static async useInvitationCode(code, userId, ipAddress = null) {
    try {
      if (!code) {
        return { success: false, message: '邀请码为空' };
      }

      const group = await GroupService.findGroupByInvitationCode(code);
      if (!group) {
        return { success: false, message: '邀请码无效或已过期' };
      }

      await dbConnection.transaction(async (query) => {
        const updateSql = `
          UPDATE user_groups 
          SET invitation_usage_count = invitation_usage_count + 1,
              updated_at = NOW()
          WHERE id = ?
        `;
        await query(updateSql, [group.id]);

        const logSql = `
          INSERT INTO invitation_code_logs (group_id, invitation_code, user_id, ip_address, used_at)
          VALUES (?, ?, ?, ?, NOW())
        `;
        await query(logSql, [group.id, code.toUpperCase(), userId, ipAddress]);
      });

      logger.info('邀请码使用成功', {
        code: code.toUpperCase(),
        groupId: group.id,
        groupName: group.name,
        userId,
        ipAddress
      });

      return {
        success: true,
        groupId: group.id,
        groupName: group.name
      };
    } catch (error) {
      logger.error('使用邀请码失败', { error: error.message, code, userId });
      return { success: false, message: '使用邀请码失败' };
    }
  }

  static async getInvitationCodeLogs(groupId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const offset = (page - 1) * limit;

      const sql = `
        SELECT 
          l.*,
          u.username,
          u.email
        FROM invitation_code_logs l
        LEFT JOIN users u ON l.user_id = u.id
        WHERE l.group_id = ?
        ORDER BY l.used_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows } = await dbConnection.query(sql, [groupId, limit, offset]);

      const countSql = 'SELECT COUNT(*) as total FROM invitation_code_logs WHERE group_id = ?';
      const { rows: countRows } = await dbConnection.query(countSql, [groupId]);
      const total = countRows[0].total;

      return {
        logs: rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取邀请码使用记录失败', { error: error.message, groupId });
      throw error;
    }
  }

  static async setGroupCreditsPool(groupId, creditsPool, operatorId = null) {
    try {
      if (typeof creditsPool !== 'number' || creditsPool < 0) {
        throw new ValidationError('积分池额度必须是非负数');
      }

      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      if (creditsPool < group.credits_pool_used) {
        throw new ValidationError(`积分池额度不能低于已使用额度(${group.credits_pool_used})`);
      }

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

  static async distributeCreditsFromPool(groupId, userId, amount, reason, distributorId) {
    try {
      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('分配金额必须是正数');
      }

      const result = await dbConnection.transaction(async (query) => {
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

        const updateGroupSql = `
          UPDATE user_groups 
          SET credits_pool_used = credits_pool_used + ?, 
              updated_at = NOW() 
          WHERE id = ?
        `;
        await query(updateGroupSql, [amount, groupId]);

        const userSql = 'SELECT * FROM users WHERE id = ?';
        const { rows: userRows } = await query(userSql, [userId]);
        
        if (userRows.length === 0) {
          throw new ValidationError('用户不存在');
        }
        
        const user = userRows[0];
        
        if (user.group_id !== groupId) {
          throw new ValidationError('用户不属于该分组');
        }

        const oldQuota = user.credits_quota || 0;
        const newQuota = oldQuota + amount;
        
        const updateUserSql = `
          UPDATE users 
          SET credits_quota = ?, updated_at = NOW()
          WHERE id = ?
        `;
        await query(updateUserSql, [newQuota, userId]);

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

  static async recycleCreditsToPool(groupId, userId, amount, reason, operatorId) {
    try {
      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('回收金额必须是正数');
      }

      const result = await dbConnection.transaction(async (query) => {
        const groupSql = 'SELECT * FROM user_groups WHERE id = ? FOR UPDATE';
        const { rows: groupRows } = await query(groupSql, [groupId]);
        
        if (groupRows.length === 0) {
          throw new ValidationError('用户分组不存在');
        }
        
        const group = groupRows[0];

        const userSql = 'SELECT * FROM users WHERE id = ? FOR UPDATE';
        const { rows: userRows } = await query(userSql, [userId]);
        
        if (userRows.length === 0) {
          throw new ValidationError('用户不存在');
        }
        
        const user = userRows[0];
        
        if (user.group_id !== groupId) {
          throw new ValidationError('用户不属于该分组');
        }

        const userAvailable = (user.credits_quota || 0) - (user.used_credits || 0);
        if (userAvailable < amount) {
          throw new ValidationError(`用户积分不足，可用余额: ${userAvailable}，需要回收: ${amount}`);
        }

        const updateGroupSql = `
          UPDATE user_groups 
          SET credits_pool_used = GREATEST(0, credits_pool_used - ?), 
              updated_at = NOW() 
          WHERE id = ?
        `;
        await query(updateGroupSql, [amount, groupId]);

        const newQuota = user.credits_quota - amount;
        
        const updateUserSql = `
          UPDATE users 
          SET credits_quota = ?, updated_at = NOW()
          WHERE id = ?
        `;
        await query(updateUserSql, [newQuota, userId]);

        const transactionSql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id, distributor_id)
          VALUES (?, ?, ?, 'group_recycle', ?, ?, ?)
        `;
        await query(transactionSql, [
          userId,
          -amount,
          newQuota - (user.used_credits || 0),
          reason || '组积分池回收',
          operatorId,
          operatorId
        ]);

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
   * 获取分组用户数量（🔧 核心修复：使用deleted_at过滤）
   */
  static async getGroupUserCount(groupId) {
    try {
      const sql = 'SELECT COUNT(*) as count FROM users WHERE group_id = ? AND deleted_at IS NULL';
      const { rows } = await dbConnection.query(sql, [groupId]);
      return rows[0].count;
    } catch (error) {
      logger.error('获取分组用户数量失败', { error: error.message, groupId });
      throw error;
    }
  }

  static async moveUsersToGroup(userIds, targetGroupId, operatorId = null) {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new ValidationError('用户ID列表不能为空');
      }

      const targetGroup = await GroupService.findGroupById(targetGroupId);
      if (!targetGroup) {
        throw new ValidationError('目标分组不存在');
      }

      const hasCapacity = await GroupService.checkGroupCapacity(targetGroupId, userIds.length);
      if (!hasCapacity) {
        const currentCount = await GroupService.getGroupUserCount(targetGroupId);
        throw new ValidationError(`目标组已满员，当前 ${currentCount}/${targetGroup.user_limit}`);
      }

      const result = await dbConnection.transaction(async (query) => {
        let updateSql;
        let params;
        
        if (targetGroup.expire_date) {
          const placeholders = userIds.map(() => '?').join(',');
          updateSql = `
            UPDATE users 
            SET group_id = ?, expire_at = ?, updated_at = NOW() 
            WHERE id IN (${placeholders}) AND deleted_at IS NULL AND role != 'super_admin'
          `;
          params = [targetGroupId, targetGroup.expire_date, ...userIds];
        } else {
          const placeholders = userIds.map(() => '?').join(',');
          updateSql = `
            UPDATE users 
            SET group_id = ?, updated_at = NOW() 
            WHERE id IN (${placeholders}) AND deleted_at IS NULL
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
          g.site_logo,
          g.invitation_enabled,
          g.invitation_code,
          g.invitation_usage_count,
          g.invitation_max_uses,
          g.invitation_expire_at
        FROM user_groups g
        LEFT JOIN users u ON g.id = u.group_id AND u.deleted_at IS NULL
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

  static async setGroupUserLimit(groupId, userLimit, operatorId = null) {
    try {
      if (typeof userLimit !== 'number' || userLimit < 1) {
        throw new ValidationError('组员上限必须是大于0的数字');
      }

      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      const currentCount = await GroupService.getGroupUserCount(groupId);
      
      if (userLimit < currentCount) {
        throw new ValidationError(`组员上限不能低于当前组员数(${currentCount}人)`);
      }

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

  static async setGroupExpireDate(groupId, expireDate, syncToUsers = false, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      await dbConnection.transaction(async (query) => {
        const updateGroupSql = 'UPDATE user_groups SET expire_date = ?, updated_at = NOW() WHERE id = ?';
        await query(updateGroupSql, [expireDate, groupId]);

        if (syncToUsers) {
          const updateUsersSql = `
            UPDATE users 
            SET expire_at = ?, updated_at = NOW() 
            WHERE group_id = ? AND role != 'super_admin' AND deleted_at IS NULL
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

  static async syncGroupExpireDateToUsers(groupId, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      if (!group.expire_date) {
        throw new ValidationError('该组未设置有效期');
      }

      const sql = `
        UPDATE users 
        SET expire_at = ?, updated_at = NOW() 
        WHERE group_id = ? AND role != 'super_admin' AND deleted_at IS NULL
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

  static async cloneGroup(sourceGroupId, newGroupName, operatorId = null) {
    try {
      const sourceGroup = await GroupService.findGroupById(sourceGroupId);
      if (!sourceGroup) {
        throw new ValidationError('源分组不存在');
      }

      const result = await dbConnection.transaction(async (query) => {
        const newGroup = await GroupService.createGroup({
          name: newGroupName,
          description: `克隆自: ${sourceGroup.name}`,
          color: sourceGroup.color,
          permissions: sourceGroup.permissions,
          is_active: true,
          expire_date: sourceGroup.expire_date
        }, operatorId);

        const sourceModelAssignmentsSql = 'SELECT model_id FROM ai_model_groups WHERE group_id = ?';
        const { rows: sourceModels } = await query(sourceModelAssignmentsSql, [sourceGroupId]);

        if (sourceModels.length > 0) {
          const deleteAutoAssignedSql = 'DELETE FROM ai_model_groups WHERE group_id = ?';
          await query(deleteAutoAssignedSql, [newGroup.id]);

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

  static async toggleGroupSiteCustomization(groupId, enabled, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

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

  static async updateGroupSiteConfig(groupId, siteConfig, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      if (!group.site_customization_enabled) {
        throw new ValidationError('该组未开启站点自定义功能');
      }

      const { site_name, site_logo } = siteConfig;

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

  static async getGroupSiteConfig(groupId) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        return null;
      }

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

  static async assignAllActiveModelsToGroup(groupId, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      const result = await dbConnection.transaction(async (query) => {
        const aiModelsSql = 'SELECT id, name, display_name FROM ai_models WHERE is_active = 1';
        const { rows: aiModels } = await query(aiModelsSql);

        if (aiModels.length === 0) {
          return { assignedCount: 0 };
        }

        const existingAssignmentsSql = 'SELECT model_id FROM ai_model_groups WHERE group_id = ?';
        const { rows: existingAssignments } = await query(existingAssignmentsSql, [groupId]);
        const existingModelIds = new Set(existingAssignments.map(a => a.model_id));

        const newModels = aiModels.filter(model => !existingModelIds.has(model.id));

        if (newModels.length === 0) {
          return { assignedCount: 0, message: '该组已分配了所有激活的AI模型' };
        }

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

  // ========== 组公告功能 ==========

  /**
   * 获取组公告内容
   * @param {number} groupId - 组ID
   * @returns {Object} 公告内容和组信息
   */
  static async getGroupAnnouncement(groupId) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      return {
        group_id: group.id,
        group_name: group.name,
        content: group.announcement || '',
        updated_at: group.updated_at
      };
    } catch (error) {
      logger.error('获取组公告失败', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * 更新组公告内容（支持Markdown）
   * @param {number} groupId - 组ID
   * @param {string} content - 公告内容（Markdown格式）
   * @param {number} operatorId - 操作者ID
   * @returns {Object} 更新后的公告信息
   */
  static async updateGroupAnnouncement(groupId, content, operatorId = null) {
    try {
      const group = await GroupService.findGroupById(groupId);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      const sql = 'UPDATE user_groups SET announcement = ?, updated_at = NOW() WHERE id = ?';
      await dbConnection.query(sql, [content || null, groupId]);

      logger.info('更新组公告成功', {
        operatorId,
        groupId,
        contentLength: (content || '').length
      });

      return {
        group_id: groupId,
        group_name: group.name,
        content: content || '',
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('更新组公告失败', { error: error.message, groupId });
      throw error;
    }
  }
}

module.exports = GroupService;
