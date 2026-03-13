/**
 * 用户分组管理控制器 - 增强版，支持自动创建组织文件夹
 * 使用Service层处理业务逻辑
 * 包含：积分池功能、组有效期、站点配置、邀请码功能、组公告功能
 * 
 * 更新：
 * - 创建组时自动创建组织共享文件夹
 * - 新增组公告 getGroupAnnouncement / updateGroupAnnouncement
 */

const { GroupService } = require('../../services/admin');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const CacheService = require('../../services/cacheService');
const ossService = require('../../services/ossService');
const UserFolder = require('../../models/UserFolder');
const fs = require('fs').promises;

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

      // 自动为新组创建组织共享文件夹
      try {
        await UserFolder.createGroupFolder(group.id, group.name, req.user.id);
        logger.info('为新组自动创建组织文件夹成功', { 
          groupId: group.id, 
          groupName: group.name,
          creatorId: req.user.id
        });
      } catch (folderError) {
        logger.error('创建组织文件夹失败，但不影响组创建', { 
          groupId: group.id,
          error: folderError.message 
        });
      }

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

      await CacheService.clearUserGroupsCache();
      await CacheService.clearAIModelsCache();

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

      await CacheService.clearUserGroupsCache();
      await CacheService.clearAIModelsCache();

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
   * 设置组邀请码（允许组管理员管理自己组的邀请码）
   */
  static async setGroupInvitationCode(req, res) {
    try {
      const { id } = req.params;
      const { enabled, code, max_uses, expire_at } = req.body;

      // 权限检查：超级管理员可以设置所有组，组管理员只能设置自己的组
      if (req.user.role === 'admin') {
        if (req.user.group_id !== parseInt(id)) {
          return ResponseHelper.forbidden(res, '只能管理本组的邀请码');
        }
        
        logger.info('组管理员设置本组邀请码', {
          adminId: req.user.id,
          groupId: id,
          enabled
        });
      }

      const result = await GroupService.setGroupInvitationCode(id, {
        enabled,
        code,
        max_uses,
        expire_at
      }, req.user.id);

      await CacheService.clearUserGroupsCache();

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('设置组邀请码失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('已被') && error.message.includes('使用')) {
        return ResponseHelper.error(res, error.message, 409);
      }
      
      if (error.message.includes('必须是5位')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '设置邀请码失败');
    }
  }

  /**
   * 获取邀请码使用记录（仅超级管理员）
   */
  static async getInvitationCodeLogs(req, res) {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;

      if (req.user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可以查看邀请码使用记录');
      }

      const result = await GroupService.getInvitationCodeLogs(id, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      return ResponseHelper.paginated(
        res, 
        result.logs, 
        result.pagination, 
        '获取邀请码使用记录成功'
      );
    } catch (error) {
      logger.error('获取邀请码使用记录失败', { 
        adminId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      return ResponseHelper.error(res, error.message || '获取邀请码使用记录失败');
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

      if (req.user.role === 'admin' && req.user.group_id !== parseInt(groupId)) {
        return ResponseHelper.forbidden(res, '只能管理本组的积分池');
      }

      if (!user_id || !amount) {
        return ResponseHelper.validation(res, ['用户ID和金额不能为空']);
      }

      let result;
      
      if (operation === 'recycle') {
        result = await GroupService.recycleCreditsToPool(
          parseInt(groupId),
          user_id,
          amount,
          reason || '组积分池回收',
          operatorId
        );
        return ResponseHelper.success(res, result, '积分回收成功');
      } else {
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
   * 设置组有效期（仅超级管理员）
   */
  static async setGroupExpireDate(req, res) {
    try {
      const { id } = req.params;
      const { expire_date, sync_to_users = false } = req.body;

      if (!expire_date) {
        return ResponseHelper.validation(res, ['有效期日期不能为空']);
      }

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
   * 同步组有效期到所有组员（仅超级管理员）
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
   * 上传组Logo（组管理员）- 使用OSS服务
   */
  static async uploadGroupLogo(req, res) {
    try {
      const { id } = req.params;
      const operatorId = req.user.id;

      if (req.user.role === 'admin') {
        if (req.user.group_id !== parseInt(id)) {
          return ResponseHelper.forbidden(res, '只能管理本组的站点配置');
        }
      }

      if (!req.file) {
        return ResponseHelper.validation(res, ['请选择要上传的Logo图片']);
      }

      const group = await GroupService.findGroupById(id);
      if (!group) {
        return ResponseHelper.notFound(res, '用户分组不存在');
      }
      
      if (!group.site_customization_enabled) {
        return ResponseHelper.forbidden(res, '该组未开启站点自定义功能');
      }

      await ossService.initialize();
      
      const fileBuffer = await fs.readFile(req.file.path);
      
      const ossKey = ossService.generateOSSKey(
        `group_${id}`,
        `logo_${req.file.filename}`,
        'logos'
      );
      
      const uploadResult = await ossService.uploadFile(fileBuffer, ossKey, {
        headers: {
          'Content-Type': req.file.mimetype,
          'Content-Disposition': `inline; filename="${req.file.originalname}"`
        }
      });
      
      await fs.unlink(req.file.path);
      
      if (group.site_logo) {
        try {
          const oldKey = group.site_logo.replace(/^https?:\/\/[^\/]+\//, '');
          await ossService.deleteFile(oldKey);
        } catch (err) {
          logger.warn('删除旧logo失败', { error: err.message });
        }
      }

      logger.info('组Logo上传成功', {
        operatorId,
        groupId: id,
        fileName: req.file.filename,
        ossKey,
        url: uploadResult.url
      });

      return ResponseHelper.success(res, {
        logo_url: uploadResult.url,
        oss_key: ossKey,
        file_name: req.file.filename,
        original_name: req.file.originalname,
        size: req.file.size
      }, 'Logo上传成功');
    } catch (error) {
      logger.error('上传组Logo失败', { 
        operatorId: req.user?.id, 
        groupId: req.params.id,
        error: error.message 
      });
      
      if (req.file && req.file.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (e) {
          // 忽略删除错误
        }
      }
      
      return ResponseHelper.error(res, error.message || '上传Logo失败');
    }
  }

  // ========== 组公告功能 ==========

  /**
   * 获取组公告
   * 权限：超管可查看所有组，组管理员只能查看自己组
   */
  static async getGroupAnnouncement(req, res) {
    try {
      const { id } = req.params;

      // 权限检查：组管理员只能查看自己组的公告
      if (req.user.role === 'admin') {
        if (req.user.group_id !== parseInt(id)) {
          return ResponseHelper.forbidden(res, '只能查看本组的公告');
        }
      }

      const result = await GroupService.getGroupAnnouncement(parseInt(id));

      return ResponseHelper.success(res, result, '获取组公告成功');
    } catch (error) {
      logger.error('获取组公告失败', {
        adminId: req.user?.id,
        groupId: req.params.id,
        error: error.message
      });

      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }

      return ResponseHelper.error(res, error.message || '获取组公告失败');
    }
  }

  /**
   * 更新组公告（支持Markdown）
   * 权限：超管可编辑所有组，组管理员只能编辑自己组
   */
  static async updateGroupAnnouncement(req, res) {
    try {
      const { id } = req.params;
      const { content } = req.body;

      // 权限检查：组管理员只能编辑自己组的公告
      if (req.user.role === 'admin') {
        if (req.user.group_id !== parseInt(id)) {
          return ResponseHelper.forbidden(res, '只能编辑本组的公告');
        }
      }

      // 内容验证
      if (content !== undefined && content !== null && typeof content !== 'string') {
        return ResponseHelper.validation(res, ['公告内容必须是文本']);
      }

      // 限制内容大小（100KB）
      if (content && content.length > 100 * 1024) {
        return ResponseHelper.validation(res, ['公告内容不能超过100KB']);
      }

      const result = await GroupService.updateGroupAnnouncement(
        parseInt(id),
        content || '',
        req.user.id
      );

      logger.info('组公告更新成功', {
        operatorId: req.user.id,
        groupId: id,
        contentLength: (content || '').length
      });

      return ResponseHelper.success(res, result, '组公告更新成功');
    } catch (error) {
      logger.error('更新组公告失败', {
        adminId: req.user?.id,
        groupId: req.params.id,
        error: error.message
      });

      if (error.message === '用户分组不存在') {
        return ResponseHelper.notFound(res, error.message);
      }

      return ResponseHelper.error(res, error.message || '更新组公告失败');
    }
  }
}

module.exports = UserGroupController;
