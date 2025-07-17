/**
 * 用户分组服务层 - 处理用户分组相关的业务逻辑
 */

const User = require('../../models/User');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');

class GroupService {
  /**
   * 获取用户分组列表
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
                 SUM(u.credits_quota - u.used_credits) as total_credits_balance
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
          WHERE g.id = ?
          GROUP BY g.id
        `;
        const { rows } = await dbConnection.query(sql, [currentUser.group_id]);
        groups = rows;
      } else {
        // 超级管理员可以看到所有组
        groups = await User.getGroups();
      }

      return groups;
    } catch (error) {
      logger.error('获取用户分组列表失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 创建用户分组
   */
  static async createGroup(groupData, operatorId = null) {
    try {
      const { name, description, color, permissions = [], is_active = true } = groupData;

      // 验证必填字段
      if (!name) {
        throw new ValidationError('分组名称不能为空');
      }

      // 检查分组名称是否已存在
      const existingGroup = await GroupService.findGroupByName(name);
      if (existingGroup) {
        throw new ConflictError('分组名称已存在');
      }

      // 创建分组
      const group = await User.createGroup({
        name,
        description,
        color,
        permissions,
        is_active
      }, operatorId);

      logger.info('创建用户分组成功', {
        operatorId,
        groupId: group.id,
        groupName: group.name
      });

      return group;
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
      const group = await User.updateGroup(groupId, updateData);
      if (!group) {
        throw new ValidationError('用户分组不存在');
      }

      // 如果更新了分组名称，检查是否重复
      if (updateData.name) {
        const existingGroup = await GroupService.findGroupByName(updateData.name);
        if (existingGroup && existingGroup.id !== groupId) {
          throw new ConflictError('分组名称已存在');
        }
      }

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

      // 使用事务批量更新
      const result = await dbConnection.transaction(async (query) => {
        const placeholders = userIds.map(() => '?').join(',');
        const sql = `
          UPDATE users 
          SET group_id = ?, updated_at = NOW() 
          WHERE id IN (${placeholders}) AND status != 'deleted'
        `;
        
        const { rows } = await query(sql, [targetGroupId, ...userIds]);
        return rows.affectedRows;
      });

      logger.info('批量移动用户到新分组成功', {
        operatorId,
        userIds,
        targetGroupId,
        affectedCount: result
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
   * 根据ID查找分组
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
          AVG(u.credits_quota - u.used_credits) as avg_credits_balance
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
   * 克隆分组配置
   */
  static async cloneGroup(sourceGroupId, newGroupName, operatorId = null) {
    try {
      const sourceGroup = await GroupService.findGroupById(sourceGroupId);
      if (!sourceGroup) {
        throw new ValidationError('源分组不存在');
      }

      // 创建新分组
      const newGroup = await GroupService.createGroup({
        name: newGroupName,
        description: `克隆自: ${sourceGroup.name}`,
        color: sourceGroup.color,
        permissions: sourceGroup.permissions,
        is_active: true
      }, operatorId);

      logger.info('克隆分组成功', {
        operatorId,
        sourceGroupId,
        newGroupId: newGroup.id,
        newGroupName
      });

      return newGroup;
    } catch (error) {
      logger.error('克隆分组失败', { error: error.message, sourceGroupId, newGroupName });
      throw error;
    }
  }
}

module.exports = GroupService;
