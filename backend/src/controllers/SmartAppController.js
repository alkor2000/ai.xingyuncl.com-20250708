/**
 * 智能应用控制器
 * 功能：处理智能应用的CRUD操作和用户端应用访问
 * 
 * 版本：v2.1.0
 * 更新：
 * - 2025-12-30 v2.0.0 支持多分类管理和应用积分扣减
 * - 2025-12-30 v2.1.0 修复会话配置同步问题：当智能应用配置更新后，自动同步到已有会话
 */

const SmartApp = require('../models/SmartApp');
const AIModel = require('../models/AIModel');
const User = require('../models/User');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const dbConnection = require('../database/connection');

/**
 * 管理端控制器
 */
const SmartAppAdminController = {
  /**
   * 获取所有智能应用列表（管理员）
   */
  async list(req, res) {
    try {
      const { page = 1, limit = 20, category_id, is_published, keyword } = req.query;
      
      const result = await SmartApp.findAll({
        page: parseInt(page),
        limit: parseInt(limit),
        category_id,
        is_published: is_published !== undefined ? parseInt(is_published) : null,
        keyword
      });
      
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
        category_ids,
        credits_per_use,
        is_published,
        sort_order
      } = req.body;
      
      if (!name) {
        return ResponseHelper.validationError(res, '应用名称不能为空');
      }
      
      if (!model_id) {
        return ResponseHelper.validationError(res, '请选择AI模型');
      }
      
      const model = await AIModel.findById(model_id);
      if (!model) {
        return ResponseHelper.validationError(res, '所选AI模型不存在');
      }
      
      const app = await SmartApp.create({
        name,
        description,
        icon,
        system_prompt,
        temperature,
        context_length,
        model_id,
        is_stream: is_stream !== undefined ? is_stream : true,
        category_ids: category_ids || [],
        credits_per_use: credits_per_use || 0,
        is_published: is_published || false,
        sort_order: sort_order || 0,
        creator_id: req.user.id
      });
      
      logger.info('智能应用创建成功', {
        appId: app.id,
        name: app.name,
        creatorId: req.user.id
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

  // ==================== 分类管理 ====================

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
  },

  /**
   * 创建分类
   */
  async createCategory(req, res) {
    try {
      const { name, color, sort_order } = req.body;
      
      if (!name || !name.trim()) {
        return ResponseHelper.validationError(res, '分类名称不能为空');
      }
      
      const category = await SmartApp.createCategory({
        name: name.trim(),
        color: color || '#1677ff',
        sort_order: sort_order || 0
      });
      
      logger.info('分类创建成功', { category, operatorId: req.user.id });
      
      ResponseHelper.success(res, category, '分类创建成功', 201);
    } catch (error) {
      logger.error('创建分类失败:', error);
      ResponseHelper.error(res, error.message || '创建分类失败');
    }
  },

  /**
   * 更新分类
   */
  async updateCategory(req, res) {
    try {
      const { id } = req.params;
      const { name, color, sort_order, is_active } = req.body;
      
      const category = await SmartApp.updateCategory(parseInt(id), {
        name,
        color,
        sort_order,
        is_active
      });
      
      if (!category) {
        return ResponseHelper.notFound(res, '分类不存在');
      }
      
      logger.info('分类更新成功', { categoryId: id, operatorId: req.user.id });
      
      ResponseHelper.success(res, category, '分类更新成功');
    } catch (error) {
      logger.error('更新分类失败:', error);
      ResponseHelper.error(res, error.message || '更新分类失败');
    }
  },

  /**
   * 删除分类
   */
  async deleteCategory(req, res) {
    try {
      const { id } = req.params;
      
      await SmartApp.deleteCategory(parseInt(id));
      
      logger.info('分类删除成功', { categoryId: id, operatorId: req.user.id });
      
      ResponseHelper.success(res, null, '分类删除成功');
    } catch (error) {
      logger.error('删除分类失败:', error);
      ResponseHelper.error(res, error.message || '删除分类失败');
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
      const { page = 1, limit = 50, category_id, keyword } = req.query;
      
      const result = await SmartApp.findPublished({
        page: parseInt(page),
        limit: parseInt(limit),
        category_id,
        keyword
      });
      
      const apps = result.apps.map(app => app.toJSON());
      
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
      
      if (!app.is_published) {
        return ResponseHelper.forbidden(res, '该应用暂未开放');
      }
      
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
      
      await app.incrementUseCount();
      
      ResponseHelper.success(res, {
        smart_app_id: app.id,
        name: app.name,
        model_name: app.model_name,
        model_display_name: app.model_display_name,
        system_prompt: app.system_prompt,
        context_length: app.context_length,
        temperature: app.temperature,
        is_stream: app.is_stream,
        credits_per_use: app.credits_per_use
      }, '获取应用配置成功');
    } catch (error) {
      logger.error('获取应用配置失败:', error);
      ResponseHelper.error(res, error.message || '获取应用配置失败');
    }
  },

  /**
   * 记录应用使用
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
      ResponseHelper.success(res, null, '记录成功');
    }
  },

  /**
   * 获取或创建智能应用专属会话
   * v2.1.0 修复：当智能应用配置更新后，自动同步到已有会话
   */
  async getOrCreateConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      // 1. 验证应用存在且已发布
      const app = await SmartApp.findById(id);
      if (!app) {
        return ResponseHelper.notFound(res, '应用不存在');
      }
      if (!app.is_published) {
        return ResponseHelper.forbidden(res, '该应用暂未开放');
      }
      
      // 2. 查找该用户该应用的现有会话
      const findSql = `
        SELECT c.*, am.name as model_name, am.display_name as model_display_name
        FROM conversations c
        LEFT JOIN ai_models am ON c.model_name = am.name
        WHERE c.user_id = ? AND c.smart_app_id = ?
        ORDER BY c.updated_at DESC
        LIMIT 1
      `;
      const { rows: existingConversations } = await dbConnection.query(findSql, [userId, id]);
      
      let conversation;
      let messages = [];
      let isNew = false;
      let configUpdated = false;
      
      if (existingConversations.length > 0) {
        // 3a. 有现有会话
        conversation = existingConversations[0];
        
        /**
         * v2.1.0 关键修复：检查并同步智能应用配置
         * 比较会话配置与智能应用当前配置，如果不同则更新
         */
        const needsUpdate = (
          conversation.model_name !== app.model_name ||
          conversation.system_prompt !== app.system_prompt ||
          conversation.context_length !== app.context_length ||
          parseFloat(conversation.ai_temperature) !== app.temperature
        );
        
        if (needsUpdate) {
          // 更新会话配置以匹配智能应用最新配置
          const updateSql = `
            UPDATE conversations 
            SET model_name = ?, 
                system_prompt = ?, 
                context_length = ?, 
                ai_temperature = ?,
                title = ?,
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `;
          await dbConnection.query(updateSql, [
            app.model_name,
            app.system_prompt,
            app.context_length,
            app.temperature,
            app.name,
            conversation.id
          ]);
          
          // 更新本地变量
          conversation.model_name = app.model_name;
          conversation.system_prompt = app.system_prompt;
          conversation.context_length = app.context_length;
          conversation.ai_temperature = app.temperature;
          conversation.title = app.name;
          configUpdated = true;
          
          logger.info('智能应用会话配置已同步更新', {
            appId: id,
            conversationId: conversation.id,
            userId,
            updatedFields: ['model_name', 'system_prompt', 'context_length', 'ai_temperature', 'title']
          });
        }
        
        // 获取会话消息（考虑 cleared_at 清空时间）
        let msgSql;
        let msgParams;
        
        if (conversation.cleared_at) {
          msgSql = `
            SELECT * FROM messages 
            WHERE conversation_id = ? 
              AND created_at > ?
              AND status IN ('completed', 'pending')
            ORDER BY sequence_number ASC, created_at ASC
            LIMIT 1000
          `;
          msgParams = [conversation.id, conversation.cleared_at];
        } else {
          msgSql = `
            SELECT * FROM messages 
            WHERE conversation_id = ?
              AND status IN ('completed', 'pending')
            ORDER BY sequence_number ASC, created_at ASC
            LIMIT 1000
          `;
          msgParams = [conversation.id];
        }
        
        const { rows: msgRows } = await dbConnection.query(msgSql, msgParams);
        messages = msgRows;
        
        // 重新获取更新后的会话信息（包含正确的model_display_name）
        if (configUpdated) {
          const refreshSql = `
            SELECT c.*, am.name as model_name, am.display_name as model_display_name
            FROM conversations c
            LEFT JOIN ai_models am ON c.model_name = am.name
            WHERE c.id = ?
          `;
          const { rows: refreshedRows } = await dbConnection.query(refreshSql, [conversation.id]);
          if (refreshedRows.length > 0) {
            conversation = refreshedRows[0];
          }
        }
        
        logger.info('获取智能应用现有会话', {
          appId: id,
          conversationId: conversation.id,
          userId,
          messageCount: messages.length,
          configUpdated
        });
      } else {
        // 3b. 没有现有会话，创建新会话
        const { v4: uuidv4 } = require('uuid');
        const conversationId = uuidv4();
        
        const createSql = `
          INSERT INTO conversations 
          (id, user_id, title, model_name, system_prompt, context_length, ai_temperature, smart_app_id, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbConnection.query(createSql, [
          conversationId,
          userId,
          app.name,
          app.model_name,
          app.system_prompt,
          app.context_length,
          app.temperature,
          id,
          -1
        ]);
        
        // 获取新创建的会话
        const getNewSql = `
          SELECT c.*, am.name as model_name, am.display_name as model_display_name
          FROM conversations c
          LEFT JOIN ai_models am ON c.model_name = am.name
          WHERE c.id = ?
        `;
        const { rows: newRows } = await dbConnection.query(getNewSql, [conversationId]);
        conversation = newRows[0];
        isNew = true;
        
        logger.info('创建智能应用新会话', {
          appId: id,
          conversationId: conversation.id,
          userId,
          appName: app.name
        });
      }
      
      // 4. 增加应用使用次数（仅首次）
      if (isNew) {
        await app.incrementUseCount();
      }
      
      // 5. 返回会话信息和消息
      ResponseHelper.success(res, {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          model_name: conversation.model_name,
          model_display_name: conversation.model_display_name,
          system_prompt: conversation.system_prompt,
          context_length: conversation.context_length,
          ai_temperature: conversation.ai_temperature,
          smart_app_id: conversation.smart_app_id,
          message_count: messages.length,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at
        },
        messages: messages,
        app: {
          id: app.id,
          name: app.name,
          icon: app.icon,
          description: app.description,
          is_stream: app.is_stream,
          credits_per_use: app.credits_per_use
        },
        isNew,
        configUpdated  // v2.1.0 新增：告知前端配置是否已更新
      }, isNew ? '会话创建成功' : (configUpdated ? '会话配置已更新' : '获取会话成功'));
      
    } catch (error) {
      logger.error('获取智能应用会话失败:', error);
      ResponseHelper.error(res, error.message || '获取会话失败');
    }
  },

  /**
   * 清空智能应用会话消息
   */
  async clearConversation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const app = await SmartApp.findById(id);
      if (!app) {
        return ResponseHelper.notFound(res, '应用不存在');
      }
      
      const findSql = `
        SELECT id FROM conversations 
        WHERE user_id = ? AND smart_app_id = ?
        LIMIT 1
      `;
      const { rows } = await dbConnection.query(findSql, [userId, id]);
      
      if (rows.length === 0) {
        return ResponseHelper.notFound(res, '会话不存在');
      }
      
      const conversationId = rows[0].id;
      
      const updateSql = `
        UPDATE conversations 
        SET cleared_at = CURRENT_TIMESTAMP, message_count = 0, total_tokens = 0, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `;
      await dbConnection.query(updateSql, [conversationId]);
      
      logger.info('清空智能应用会话消息', {
        appId: id,
        conversationId,
        userId
      });
      
      ResponseHelper.success(res, { conversationId }, '会话已清空');
      
    } catch (error) {
      logger.error('清空智能应用会话失败:', error);
      ResponseHelper.error(res, error.message || '清空会话失败');
    }
  }
};

module.exports = {
  SmartAppAdminController,
  SmartAppUserController
};
