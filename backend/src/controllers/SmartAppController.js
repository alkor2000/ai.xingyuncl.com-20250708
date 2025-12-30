/**
 * 智能应用控制器
 * 功能：处理智能应用的CRUD操作和用户端应用访问
 * 
 * 管理端API（需要超级管理员权限）：
 * - GET    /admin/smart-apps           获取所有应用列表
 * - GET    /admin/smart-apps/:id       获取应用详情
 * - POST   /admin/smart-apps           创建新应用
 * - PUT    /admin/smart-apps/:id       更新应用
 * - DELETE /admin/smart-apps/:id       删除应用
 * - POST   /admin/smart-apps/:id/toggle-publish  切换发布状态
 * 
 * 用户端API（需要登录）：
 * - GET    /smart-apps                 获取已发布的应用列表
 * - GET    /smart-apps/:id             获取应用详情
 * - GET    /smart-apps/categories      获取分类列表
 * - GET    /smart-apps/:id/config      获取应用配置
 * - POST   /smart-apps/:id/use         记录应用使用
 * 
 * 版本：v1.1.0
 * 更新：2025-12-30 添加recordUse方法
 */

const SmartApp = require('../models/SmartApp');
const AIModel = require('../models/AIModel');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 管理端控制器
 */
const SmartAppAdminController = {
  /**
   * 获取所有智能应用列表（管理员）
   */
  async list(req, res) {
    try {
      const { page = 1, limit = 20, category, is_published, keyword } = req.query;
      
      const result = await SmartApp.findAll({
        page: parseInt(page),
        limit: parseInt(limit),
        category,
        is_published: is_published !== undefined ? parseInt(is_published) : null,
        keyword
      });
      
      // 返回完整信息给管理员
      const apps = result.apps.map(app => app.toFullJSON());
      
      ResponseHelper.success(res, {
        apps,
        pagination: result.pagination
      }, '获取智能应用列表成功');
    } catch (error) {
      logger.error('获取智能应用列表失败:', error);
      ResponseHelper.error(res, error.message || '获取智能应用列表失败');
    }
  },

  /**
   * 获取智能应用详情（管理员）
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '智能应用不存在');
      }
      
      ResponseHelper.success(res, app.toFullJSON(), '获取智能应用详情成功');
    } catch (error) {
      logger.error('获取智能应用详情失败:', error);
      ResponseHelper.error(res, error.message || '获取智能应用详情失败');
    }
  },

  /**
   * 创建新智能应用
   */
  async create(req, res) {
    try {
      const {
        name,
        description,
        icon,
        system_prompt,
        temperature,
        context_length,
        model_id,
        is_stream,
        category,
        is_published,
        sort_order
      } = req.body;
      
      // 验证必填字段
      if (!name) {
        return ResponseHelper.validationError(res, '应用名称不能为空');
      }
      
      if (!model_id) {
        return ResponseHelper.validationError(res, '请选择AI模型');
      }
      
      // 验证模型是否存在
      const model = await AIModel.findById(model_id);
      if (!model) {
        return ResponseHelper.validationError(res, '所选AI模型不存在');
      }
      
      // 创建应用
      const app = await SmartApp.create({
        name,
        description,
        icon,
        system_prompt,
        temperature,
        context_length,
        model_id,
        is_stream: is_stream !== undefined ? is_stream : true,
        category,
        is_published: is_published || false,
        sort_order: sort_order || 0,
        creator_id: req.user.id
      });
      
      logger.info('智能应用创建成功', {
        appId: app.id,
        name: app.name,
        creatorId: req.user.id,
        creatorUsername: req.user.username
      });
      
      ResponseHelper.success(res, app.toFullJSON(), '智能应用创建成功', 201);
    } catch (error) {
      logger.error('创建智能应用失败:', error);
      ResponseHelper.error(res, error.message || '创建智能应用失败');
    }
  },

  /**
   * 更新智能应用
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '智能应用不存在');
      }
      
      // 如果更新了模型ID，验证模型是否存在
      if (updateData.model_id) {
        const model = await AIModel.findById(updateData.model_id);
        if (!model) {
          return ResponseHelper.validationError(res, '所选AI模型不存在');
        }
      }
      
      const updatedApp = await app.update(updateData);
      
      logger.info('智能应用更新成功', {
        appId: id,
        updatedBy: req.user.id
      });
      
      ResponseHelper.success(res, updatedApp.toFullJSON(), '智能应用更新成功');
    } catch (error) {
      logger.error('更新智能应用失败:', error);
      ResponseHelper.error(res, error.message || '更新智能应用失败');
    }
  },

  /**
   * 删除智能应用
   */
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '智能应用不存在');
      }
      
      await app.delete();
      
      logger.info('智能应用删除成功', {
        appId: id,
        name: app.name,
        deletedBy: req.user.id
      });
      
      ResponseHelper.success(res, null, '智能应用删除成功');
    } catch (error) {
      logger.error('删除智能应用失败:', error);
      ResponseHelper.error(res, error.message || '删除智能应用失败');
    }
  },

  /**
   * 切换发布状态
   */
  async togglePublish(req, res) {
    try {
      const { id } = req.params;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '智能应用不存在');
      }
      
      const updatedApp = await app.togglePublish();
      
      logger.info('智能应用发布状态切换', {
        appId: id,
        name: app.name,
        newStatus: updatedApp.is_published ? '已发布' : '未发布',
        operatorId: req.user.id
      });
      
      ResponseHelper.success(res, updatedApp.toFullJSON(), 
        updatedApp.is_published ? '应用已发布' : '应用已取消发布');
    } catch (error) {
      logger.error('切换发布状态失败:', error);
      ResponseHelper.error(res, error.message || '切换发布状态失败');
    }
  },

  /**
   * 获取所有分类（管理员）
   */
  async getCategories(req, res) {
    try {
      const categories = await SmartApp.getCategories();
      ResponseHelper.success(res, categories, '获取分类列表成功');
    } catch (error) {
      logger.error('获取分类列表失败:', error);
      ResponseHelper.error(res, error.message || '获取分类列表失败');
    }
  }
};

/**
 * 用户端控制器
 */
const SmartAppUserController = {
  /**
   * 获取已发布的智能应用列表
   */
  async list(req, res) {
    try {
      const { page = 1, limit = 50, category, keyword } = req.query;
      
      const result = await SmartApp.findPublished({
        page: parseInt(page),
        limit: parseInt(limit),
        category,
        keyword
      });
      
      // 用户端不返回系统提示词内容，直接返回apps数组
      const apps = result.apps.map(app => app.toJSON());
      
      // 直接返回数组格式，方便前端使用
      ResponseHelper.success(res, apps, '获取应用列表成功');
    } catch (error) {
      logger.error('获取应用列表失败:', error);
      ResponseHelper.error(res, error.message || '获取应用列表失败');
    }
  },

  /**
   * 获取智能应用详情（用户端）
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '应用不存在');
      }
      
      // 未发布的应用普通用户无法访问
      if (!app.is_published) {
        return ResponseHelper.forbidden(res, '该应用暂未开放');
      }
      
      // 用户端不返回系统提示词
      ResponseHelper.success(res, app.toJSON(), '获取应用详情成功');
    } catch (error) {
      logger.error('获取应用详情失败:', error);
      ResponseHelper.error(res, error.message || '获取应用详情失败');
    }
  },

  /**
   * 获取分类列表和统计
   */
  async getCategories(req, res) {
    try {
      const [categories, stats] = await Promise.all([
        SmartApp.getCategories(),
        SmartApp.getCategoryStats()
      ]);
      
      ResponseHelper.success(res, {
        categories,
        stats
      }, '获取分类信息成功');
    } catch (error) {
      logger.error('获取分类信息失败:', error);
      ResponseHelper.error(res, error.message || '获取分类信息失败');
    }
  },

  /**
   * 获取应用配置（用于创建会话）
   */
  async getConfig(req, res) {
    try {
      const { id } = req.params;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '应用不存在');
      }
      
      if (!app.is_published) {
        return ResponseHelper.forbidden(res, '该应用暂未开放');
      }
      
      // 增加使用次数
      await app.incrementUseCount();
      
      // 返回创建会话所需的配置
      ResponseHelper.success(res, {
        smart_app_id: app.id,
        name: app.name,
        model_name: app.model_name,
        model_display_name: app.model_display_name,
        system_prompt: app.system_prompt, // 这里需要返回，用于创建会话
        context_length: app.context_length,
        temperature: app.temperature,
        is_stream: app.is_stream
      }, '获取应用配置成功');
    } catch (error) {
      logger.error('获取应用配置失败:', error);
      ResponseHelper.error(res, error.message || '获取应用配置失败');
    }
  },

  /**
   * 记录应用使用（仅增加使用次数）
   */
  async recordUse(req, res) {
    try {
      const { id } = req.params;
      
      const app = await SmartApp.findById(id);
      
      if (!app) {
        return ResponseHelper.notFound(res, '应用不存在');
      }
      
      if (!app.is_published) {
        return ResponseHelper.forbidden(res, '该应用暂未开放');
      }
      
      // 增加使用次数
      await app.incrementUseCount();
      
      logger.info('应用使用记录', {
        appId: app.id,
        appName: app.name,
        userId: req.user.id,
        username: req.user.username
      });
      
      ResponseHelper.success(res, { 
        use_count: app.use_count + 1 
      }, '记录成功');
    } catch (error) {
      logger.error('记录应用使用失败:', error);
      // 使用记录失败不影响主流程
      ResponseHelper.success(res, null, '记录成功');
    }
  }
};

module.exports = {
  SmartAppAdminController,
  SmartAppUserController
};
