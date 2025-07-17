/**
 * 用户分组管理控制器 - 使用Service层处理业务逻辑
 */

const { GroupService } = require('../../services/admin');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserGroupController {
  /**
   * 获取用户分组列表
   */
  static async getUserGroups(req, res) {
    try {
      const currentUser = req.user;
      const groups = await GroupService.getGroups(currentUser);

      return ResponseHelper.success(res, groups, '获取用户分组列表成功');
    } catch (error) {
      logger.error('获取用户分组列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取用户分组列表失败');
    }
  }

  /**
   * 创建用户分组
   */
  static async createUserGroup(req, res) {
    try {
      const groupData = req.body;
      const group = await GroupService.createGroup(groupData, req.user.id);

      return ResponseHelper.success(res, group, '用户分组创建成功', 201);
    } catch (error) {
      logger.error('创建用户分组失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      
      if (error.message.includes('已存在')) {
        return ResponseHelper.error(res, error.message, 409);
      }
      
      if (error.message.includes('不能为空')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '创建用户分组失败');
    }
  }

  /**
   * 更新用户分组
   */
  static async updateUserGroup(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const group = await GroupService.updateGroup(id, updateData, req.user.id);

      return ResponseHelper.success(res, group, '用户分组更新成功');
    } catch (error) {
      logger.error('更新用户分组失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('已存在')) {
        return ResponseHelper.error(res, error.message, 409);
      }
      
      return ResponseHelper.error(res, error.message || '更新用户分组失败');
    }
  }

  /**
   * 删除用户分组
   */
  static async deleteUserGroup(req, res) {
    try {
      const { id } = req.params;
      const result = await GroupService.deleteGroup(id, req.user.id);

      return ResponseHelper.success(res, null, result.message);
    } catch (error) {
      logger.error('删除用户分组失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message.includes('还有') && error.message.includes('用户')) {
        return ResponseHelper.error(res, error.message, 400);
      }
      
      return ResponseHelper.error(res, error.message || '删除用户分组失败');
    }
  }
}

module.exports = UserGroupController;
