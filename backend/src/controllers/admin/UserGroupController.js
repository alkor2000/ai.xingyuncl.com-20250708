/**
 * 用户分组管理控制器 - 使用Service层处理业务逻辑（包含积分池功能、组有效期和站点配置）
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

  /**
   * 设置组积分池（仅超级管理员）
   */
  static async setGroupCreditsPool(req, res) {
    try {
      const { id } = req.params;
      const { credits_pool } = req.body;

      if (typeof credits_pool !== 'number') {
        return ResponseHelper.validation(res, ['积分池额度必须是数字']);
      }

      const result = await GroupService.setGroupCreditsPool(id, credits_pool, req.user.id);

      return ResponseHelper.success(res, result, '组积分池设置成功');
    } catch (error) {
      logger.error('设置组积分池失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('不能低于')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '设置组积分池失败');
    }
  }

  /**
   * 从组积分池分配积分（组管理员和超级管理员）
   */
  static async distributeGroupCredits(req, res) {
    try {
      const { id: groupId } = req.params;
      const { user_id, amount, reason, operation = 'distribute' } = req.body;
      const operatorId = req.user.id;

      // 权限检查
      if (req.user.role === 'admin' && req.user.group_id !== parseInt(groupId)) {
        return ResponseHelper.forbidden(res, '只能管理本组的积分池');
      }

      if (!user_id || !amount) {
        return ResponseHelper.validation(res, ['用户ID和金额不能为空']);
      }

      let result;
      
      // 根据操作类型调用不同的方法
      if (operation === 'recycle') {
        // 回收积分
        result = await GroupService.recycleCreditsToPool(
          parseInt(groupId),
          user_id,
          amount,
          reason || '组积分池回收',
          operatorId
        );
        return ResponseHelper.success(res, result, '积分回收成功');
      } else {
        // 分配积分
        result = await GroupService.distributeCreditsFromPool(
          parseInt(groupId),
          user_id,
          amount,
          reason || '组积分池分配',
          operatorId
        );
        return ResponseHelper.success(res, result, '积分分配成功');
      }
    } catch (error) {
      logger.error('组积分池操作失败', { 
        operatorId: req.user?.id, 
        groupId: req.params.id,
        operation: req.body.operation,
        error: error.message 
      });
      
      if (error.message.includes('不存在')) {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('余额不足') || error.message.includes('必须是正数') || error.message.includes('积分不足')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '积分操作失败');
    }
  }

  /**
   * 设置组员上限（仅超级管理员）
   */
  static async setGroupUserLimit(req, res) {
    try {
      const { id } = req.params;
      const { user_limit } = req.body;

      if (typeof user_limit !== 'number') {
        return ResponseHelper.validation(res, ['组员上限必须是数字']);
      }

      const result = await GroupService.setGroupUserLimit(id, user_limit, req.user.id);

      return ResponseHelper.success(res, result, '组员上限设置成功');
    } catch (error) {
      logger.error('设置组员上限失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('不能低于')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '设置组员上限失败');
    }
  }

  /**
   * 设置组有效期（新增，仅超级管理员）
   */
  static async setGroupExpireDate(req, res) {
    try {
      const { id } = req.params;
      const { expire_date, sync_to_users = false } = req.body;

      if (!expire_date) {
        return ResponseHelper.validation(res, ['有效期日期不能为空']);
      }

      // 验证日期格式
      const expireDate = new Date(expire_date);
      if (isNaN(expireDate.getTime())) {
        return ResponseHelper.validation(res, ['无效的日期格式']);
      }

      const result = await GroupService.setGroupExpireDate(
        id, 
        expireDate, 
        sync_to_users,
        req.user.id
      );

      return ResponseHelper.success(res, result, '组有效期设置成功');
    } catch (error) {
      logger.error('设置组有效期失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '设置组有效期失败');
    }
  }

  /**
   * 同步组有效期到所有组员（新增，仅超级管理员）
   */
  static async syncGroupExpireDateToUsers(req, res) {
    try {
      const { id } = req.params;

      const result = await GroupService.syncGroupExpireDateToUsers(id, req.user.id);

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('同步组有效期失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message === '该组未设置有效期') {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '同步组有效期失败');
    }
  }

  /**
   * 设置组站点自定义开关（仅超级管理员）
   */
  static async toggleGroupSiteCustomization(req, res) {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return ResponseHelper.validation(res, ['enabled参数必须是布尔值']);
      }

      const result = await GroupService.toggleGroupSiteCustomization(id, enabled, req.user.id);

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('设置组站点自定义开关失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '设置组站点自定义开关失败');
    }
  }

  /**
   * 更新组站点配置（组管理员）
   */
  static async updateGroupSiteConfig(req, res) {
    try {
      const { id } = req.params;
      const { site_name, site_logo } = req.body;
      const operatorId = req.user.id;

      // 权限检查 - 组管理员只能更新自己组的配置
      if (req.user.role === 'admin') {
        if (req.user.group_id !== parseInt(id)) {
          return ResponseHelper.forbidden(res, '只能管理本组的站点配置');
        }
      }

      const result = await GroupService.updateGroupSiteConfig(
        id, 
        { site_name, site_logo },
        operatorId
      );

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('更新组站点配置失败', { 
        operatorId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('未开启站点自定义')) {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '更新组站点配置失败');
    }
  }

  /**
   * 上传组Logo（组管理员）
   */
  static async uploadGroupLogo(req, res) {
    try {
      const { id } = req.params;
      const operatorId = req.user.id;

      // 权限检查 - 组管理员只能上传自己组的logo
      if (req.user.role === 'admin') {
        if (req.user.group_id !== parseInt(id)) {
          return ResponseHelper.forbidden(res, '只能管理本组的站点配置');
        }
      }

      // 检查是否有文件上传
      if (!req.file) {
        return ResponseHelper.validation(res, ['请选择要上传的Logo图片']);
      }

      // 构建文件URL（使用实际的文件名）
      const logoUrl = `/uploads/system/${req.file.filename}`;

      // 更新组配置
      const result = await GroupService.updateGroupSiteConfig(
        id,
        { site_logo: logoUrl },
        operatorId
      );

      return ResponseHelper.success(res, {
        ...result,
        logo_url: logoUrl
      }, 'Logo上传成功');
    } catch (error) {
      logger.error('上传组Logo失败', { 
        operatorId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      return ResponseHelper.error(res, error.message || '上传Logo失败');
    }
  }
}

module.exports = UserGroupController;
