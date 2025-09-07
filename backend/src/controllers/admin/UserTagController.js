/**
 * 用户标签控制器 - 处理标签相关HTTP请求
 */

const UserTagService = require('../../services/admin/UserTagService');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserTagController {
  /**
   * 获取组内所有标签
   * GET /api/admin/user-tags/group/:groupId
   */
  static async getGroupTags(req, res) {
    try {
      const { groupId } = req.params;
      const { includeInactive } = req.query;
      const currentUser = req.user;

      // 权限检查：组管理员只能查看本组标签
      if (currentUser.role === 'admin' && currentUser.group_id !== parseInt(groupId)) {
        return ResponseHelper.forbidden(res, '无权查看其他组的标签');
      }

      const tags = await UserTagService.getGroupTags(
        groupId, 
        includeInactive === 'true'
      );

      return ResponseHelper.success(res, tags, '获取标签列表成功');
    } catch (error) {
      logger.error('获取组标签失败', { 
        error: error.message, 
        groupId: req.params.groupId,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '获取标签列表失败');
    }
  }

  /**
   * 批量获取标签信息
   * POST /api/admin/user-tags/batch-info
   * 新增：用于批量获取标签的详细信息
   */
  static async getBatchTagInfo(req, res) {
    try {
      const { tag_ids } = req.body;
      const currentUser = req.user;

      // 验证输入
      if (!Array.isArray(tag_ids) || tag_ids.length === 0) {
        return ResponseHelper.validation(res, ['tag_ids必须是非空数组']);
      }

      // 批量获取标签信息
      const tags = await UserTagService.getBatchTagInfo(tag_ids, currentUser);

      return ResponseHelper.success(res, tags, '批量获取标签信息成功');
    } catch (error) {
      logger.error('批量获取标签信息失败', { 
        error: error.message, 
        tagIds: req.body.tag_ids,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '批量获取标签信息失败');
    }
  }

  /**
   * 创建标签
   * POST /api/admin/user-tags
   */
  static async createTag(req, res) {
    try {
      const currentUser = req.user;
      const tagData = req.body;

      // 权限检查：组管理员只能为本组创建标签
      if (currentUser.role === 'admin') {
        if (!tagData.group_id || tagData.group_id !== currentUser.group_id) {
          tagData.group_id = currentUser.group_id; // 强制设置为本组
        }
      }

      const newTag = await UserTagService.createTag(tagData, currentUser.id);

      return ResponseHelper.success(res, newTag, '标签创建成功', 201);
    } catch (error) {
      logger.error('创建标签失败', { 
        error: error.message, 
        tagData: req.body,
        operatorId: req.user?.id 
      });
      
      if (error.message.includes('已存在')) {
        return ResponseHelper.conflict(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '创建标签失败');
    }
  }

  /**
   * 更新标签
   * PUT /api/admin/user-tags/:id
   */
  static async updateTag(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const currentUser = req.user;

      // 先获取标签信息以检查权限
      const tags = await UserTagService.getGroupTags(null, true);
      const tag = tags.find(t => t.id === parseInt(id));
      
      if (!tag) {
        return ResponseHelper.notFound(res, '标签不存在');
      }

      // 权限检查：组管理员只能更新本组标签
      if (currentUser.role === 'admin' && tag.group_id !== currentUser.group_id) {
        return ResponseHelper.forbidden(res, '无权更新其他组的标签');
      }

      const updatedTag = await UserTagService.updateTag(id, updateData, currentUser.id);

      return ResponseHelper.success(res, updatedTag, '标签更新成功');
    } catch (error) {
      logger.error('更新标签失败', { 
        error: error.message, 
        tagId: req.params.id,
        updateData: req.body,
        operatorId: req.user?.id 
      });
      
      if (error.message.includes('已存在')) {
        return ResponseHelper.conflict(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '更新标签失败');
    }
  }

  /**
   * 删除标签
   * DELETE /api/admin/user-tags/:id
   */
  static async deleteTag(req, res) {
    try {
      const { id } = req.params;
      const currentUser = req.user;

      // 先获取标签信息以检查权限
      const tags = await UserTagService.getGroupTags(null, true);
      const tag = tags.find(t => t.id === parseInt(id));
      
      if (!tag) {
        return ResponseHelper.notFound(res, '标签不存在');
      }

      // 权限检查：组管理员只能删除本组标签
      if (currentUser.role === 'admin' && tag.group_id !== currentUser.group_id) {
        return ResponseHelper.forbidden(res, '无权删除其他组的标签');
      }

      await UserTagService.deleteTag(id, currentUser.id);

      return ResponseHelper.success(res, null, '标签删除成功');
    } catch (error) {
      logger.error('删除标签失败', { 
        error: error.message, 
        tagId: req.params.id,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '删除标签失败');
    }
  }

  /**
   * 获取用户的标签
   * GET /api/admin/user-tags/user/:userId
   */
  static async getUserTags(req, res) {
    try {
      const { userId } = req.params;
      const currentUser = req.user;

      // 权限检查：组管理员只能查看本组用户的标签
      if (currentUser.role === 'admin') {
        const { rows: [user] } = await require('../../database/connection').query(
          'SELECT group_id FROM users WHERE id = ?',
          [userId]
        );
        
        if (!user || user.group_id !== currentUser.group_id) {
          return ResponseHelper.forbidden(res, '无权查看其他组用户的标签');
        }
      }

      const tags = await UserTagService.getUserTags(userId);

      return ResponseHelper.success(res, tags, '获取用户标签成功');
    } catch (error) {
      logger.error('获取用户标签失败', { 
        error: error.message, 
        userId: req.params.userId,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '获取用户标签失败');
    }
  }

  /**
   * 更新用户的标签（覆盖式）
   * PUT /api/admin/user-tags/user/:userId
   */
  static async updateUserTags(req, res) {
    try {
      const { userId } = req.params;
      const { tagIds } = req.body;
      const currentUser = req.user;

      // 权限检查：组管理员只能管理本组用户的标签
      if (currentUser.role === 'admin') {
        const { rows: [user] } = await require('../../database/connection').query(
          'SELECT group_id FROM users WHERE id = ?',
          [userId]
        );
        
        if (!user || user.group_id !== currentUser.group_id) {
          return ResponseHelper.forbidden(res, '无权管理其他组用户的标签');
        }
      }

      // 验证标签ID数组
      if (!Array.isArray(tagIds)) {
        return ResponseHelper.validation(res, ['标签ID必须是数组']);
      }

      await UserTagService.updateUserTags(userId, tagIds, currentUser.id);

      // 返回更新后的标签列表
      const updatedTags = await UserTagService.getUserTags(userId);

      return ResponseHelper.success(res, updatedTags, '用户标签更新成功');
    } catch (error) {
      logger.error('更新用户标签失败', { 
        error: error.message, 
        userId: req.params.userId,
        tagIds: req.body.tagIds,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '更新用户标签失败');
    }
  }

  /**
   * 批量为用户分配标签
   * POST /api/admin/user-tags/user/:userId/assign
   */
  static async assignTagsToUser(req, res) {
    try {
      const { userId } = req.params;
      const { tagIds } = req.body;
      const currentUser = req.user;

      // 权限检查
      if (currentUser.role === 'admin') {
        const { rows: [user] } = await require('../../database/connection').query(
          'SELECT group_id FROM users WHERE id = ?',
          [userId]
        );
        
        if (!user || user.group_id !== currentUser.group_id) {
          return ResponseHelper.forbidden(res, '无权管理其他组用户的标签');
        }
      }

      await UserTagService.assignTagsToUser(userId, tagIds, currentUser.id);

      // 返回更新后的标签列表
      const updatedTags = await UserTagService.getUserTags(userId);

      return ResponseHelper.success(res, updatedTags, '标签分配成功');
    } catch (error) {
      logger.error('分配标签失败', { 
        error: error.message, 
        userId: req.params.userId,
        tagIds: req.body.tagIds,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '分配标签失败');
    }
  }

  /**
   * 移除用户的标签
   * POST /api/admin/user-tags/user/:userId/remove
   */
  static async removeUserTags(req, res) {
    try {
      const { userId } = req.params;
      const { tagIds } = req.body;
      const currentUser = req.user;

      // 权限检查
      if (currentUser.role === 'admin') {
        const { rows: [user] } = await require('../../database/connection').query(
          'SELECT group_id FROM users WHERE id = ?',
          [userId]
        );
        
        if (!user || user.group_id !== currentUser.group_id) {
          return ResponseHelper.forbidden(res, '无权管理其他组用户的标签');
        }
      }

      await UserTagService.removeUserTags(userId, tagIds, currentUser.id);

      // 返回更新后的标签列表
      const updatedTags = await UserTagService.getUserTags(userId);

      return ResponseHelper.success(res, updatedTags, '标签移除成功');
    } catch (error) {
      logger.error('移除标签失败', { 
        error: error.message, 
        userId: req.params.userId,
        tagIds: req.body.tagIds,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '移除标签失败');
    }
  }

  /**
   * 根据标签筛选用户
   * POST /api/admin/user-tags/filter-users
   */
  static async filterUsersByTags(req, res) {
    try {
      const { groupId, tagIds, includeAll = false } = req.body;
      const currentUser = req.user;

      // 权限检查：组管理员只能筛选本组用户
      const targetGroupId = currentUser.role === 'admin' 
        ? currentUser.group_id 
        : (groupId || currentUser.group_id);

      if (currentUser.role === 'admin' && groupId && groupId !== currentUser.group_id) {
        return ResponseHelper.forbidden(res, '无权筛选其他组的用户');
      }

      const users = await UserTagService.getUsersByTags(
        targetGroupId, 
        tagIds, 
        includeAll
      );

      return ResponseHelper.success(res, users, '筛选用户成功');
    } catch (error) {
      logger.error('根据标签筛选用户失败', { 
        error: error.message, 
        body: req.body,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '筛选用户失败');
    }
  }

  /**
   * 获取标签统计
   * GET /api/admin/user-tags/statistics/:groupId
   */
  static async getTagStatistics(req, res) {
    try {
      const { groupId } = req.params;
      const currentUser = req.user;

      // 权限检查：组管理员只能查看本组统计
      const targetGroupId = currentUser.role === 'admin' 
        ? currentUser.group_id 
        : (groupId || currentUser.group_id);

      if (currentUser.role === 'admin' && groupId && parseInt(groupId) !== currentUser.group_id) {
        return ResponseHelper.forbidden(res, '无权查看其他组的统计');
      }

      const statistics = await UserTagService.getTagStatistics(targetGroupId);

      return ResponseHelper.success(res, statistics, '获取标签统计成功');
    } catch (error) {
      logger.error('获取标签统计失败', { 
        error: error.message, 
        groupId: req.params.groupId,
        operatorId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '获取标签统计失败');
    }
  }
}

module.exports = UserTagController;
