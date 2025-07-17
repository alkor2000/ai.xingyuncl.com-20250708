/**
 * 用户分组管理控制器 - 使用中间件处理权限，移除重复检查
 */

const User = require('../../models/User');
const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserGroupController {
  /**
   * 获取用户分组列表 - 管理员只能看到自己的组
   */
  static async getUserGroups(req, res) {
    try {
      const currentUser = req.user;
      let groups;

      if (currentUser.role === 'admin' && currentUser.group_id) {
        // 管理员只能看到自己所在的组
        const sql = `
          SELECT g.*, 
                 COUNT(u.id) as user_count,
                 AVG(u.used_tokens) as avg_tokens_used,
                 AVG(u.used_credits) as avg_credits_used
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

      logger.info('获取用户分组列表成功', { 
        adminId: req.user.id,
        adminRole: req.user.role,
        groupCount: groups.length
      });

      return ResponseHelper.success(res, groups, '获取用户分组列表成功');
    } catch (error) {
      logger.error('获取用户分组列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户分组列表失败');
    }
  }

  /**
   * 创建用户分组 - 权限检查已在中间件处理
   */
  static async createUserGroup(req, res) {
    try {
      const groupData = req.body;
      const createdBy = req.user.id;

      const group = await User.createGroup(groupData, createdBy);

      logger.info('创建用户分组成功', { 
        adminId: req.user.id,
        groupId: group.id,
        groupName: group.name
      });

      return ResponseHelper.success(res, group, '用户分组创建成功', 201);
    } catch (error) {
      logger.error('创建用户分组失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '创建用户分组失败');
    }
  }

  /**
   * 更新用户分组 - 权限检查已在中间件处理
   */
  static async updateUserGroup(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const group = await User.updateGroup(id, updateData);
      if (!group) {
        return ResponseHelper.notFound(res, '用户分组不存在');
      }

      logger.info('更新用户分组成功', { 
        adminId: req.user.id,
        groupId: id,
        updateFields: Object.keys(updateData)
      });

      return ResponseHelper.success(res, group, '用户分组更新成功');
    } catch (error) {
      logger.error('更新用户分组失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '更新用户分组失败');
    }
  }

  /**
   * 删除用户分组 - 权限检查已在中间件处理
   */
  static async deleteUserGroup(req, res) {
    try {
      const { id } = req.params;

      await User.deleteGroup(id);

      logger.info('删除用户分组成功', { 
        adminId: req.user.id,
        deletedGroupId: id
      });

      return ResponseHelper.success(res, null, '用户分组删除成功');
    } catch (error) {
      logger.error('删除用户分组失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message.includes('该分组下还有') ? error.message : '删除用户分组失败');
    }
  }
}

module.exports = UserGroupController;
