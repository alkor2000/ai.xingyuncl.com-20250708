/**
 * 管理员控制器
 */

const User = require('../models/User');
const AIModel = require('../models/AIModel');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { ValidationError, AuthorizationError } = require('../utils/errors');
const dbConnection = require('../database/connection');

class AdminController {
  /**
   * 获取系统统计信息
   * GET /api/admin/stats
   */
  static async getSystemStats(req, res) {
    try {
      // 获取用户统计
      const { rows: userStats } = await dbConnection.query(`
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END) as super_admins,
          SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
          SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as users,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today_new_users
        FROM users
      `);

      // 获取对话统计
      const { rows: conversationStats } = await dbConnection.query(`
        SELECT 
          COUNT(*) as total_conversations,
          SUM(message_count) as total_messages,
          SUM(total_tokens) as total_tokens,
          SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today_conversations
        FROM conversations
      `);

      // 获取Token使用统计
      const { rows: tokenStats } = await dbConnection.query(`
        SELECT 
          SUM(used_tokens) as total_used_tokens,
          SUM(token_quota) as total_quota_tokens,
          AVG(used_tokens) as avg_used_tokens
        FROM users
      `);

      // 获取活跃用户统计
      const { rows: activeStats } = await dbConnection.query(`
        SELECT 
          COUNT(DISTINCT user_id) as daily_active_users
        FROM conversations 
        WHERE DATE(last_message_at) = CURDATE()
      `);

      // 获取AI模型使用统计
      const { rows: modelStats } = await dbConnection.query(`
        SELECT 
          model_name,
          COUNT(*) as conversation_count,
          SUM(total_tokens) as total_tokens
        FROM conversations 
        GROUP BY model_name 
        ORDER BY conversation_count DESC
      `);

      const stats = {
        users: userStats[0],
        conversations: conversationStats[0],
        tokens: tokenStats[0],
        active: activeStats[0],
        models: modelStats
      };

      return ResponseHelper.success(res, stats, '获取系统统计成功');
    } catch (error) {
      logger.error('获取系统统计失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取系统统计失败');
    }
  }

  /**
   * 获取用户列表
   * GET /api/admin/users
   */
  static async getUsers(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        role = null, 
        status = null, 
        search = null 
      } = req.query;

      const result = await User.getList({
        page: parseInt(page),
        limit: parseInt(limit),
        role,
        status,
        search
      });

      return ResponseHelper.paginated(res, result.users, result.pagination, '获取用户列表成功');
    } catch (error) {
      logger.error('获取用户列表失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户列表失败');
    }
  }

  /**
   * 创建用户
   * POST /api/admin/users
   */
  static async createUser(req, res) {
    try {
      const { email, username, password, role = 'user', token_quota = 10000 } = req.body;

      if (!email || !username || !password) {
        return ResponseHelper.validation(res, ['邮箱、用户名和密码不能为空']);
      }

      // 只有超级管理员可以创建管理员账户
      if ((role === 'admin' || role === 'super_admin') && req.user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '权限不足，无法创建管理员账户');
      }

      const user = await User.create({
        email: email.toLowerCase(),
        username,
        password,
        role,
        token_quota: parseInt(token_quota)
      });

      logger.info('管理员创建用户成功', { 
        adminId: req.user.id,
        newUserId: user.id,
        role
      });

      return ResponseHelper.success(res, user.toJSON(), '用户创建成功', 201);
    } catch (error) {
      logger.error('创建用户失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message.includes('已被') ? error.message : '创建用户失败');
    }
  }

  /**
   * 获取用户详情
   * GET /api/admin/users/:id
   */
  static async getUserDetail(req, res) {
    try {
      const { id } = req.params;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 获取用户的权限列表
      const permissions = await user.getPermissions();

      // 获取用户的对话统计
      const { rows: conversationStats } = await dbConnection.query(`
        SELECT 
          COUNT(*) as total_conversations,
          SUM(message_count) as total_messages,
          SUM(total_tokens) as total_tokens,
          MAX(last_message_at) as last_conversation_at
        FROM conversations 
        WHERE user_id = ?
      `, [id]);

      const userDetail = {
        user: user.toJSON(),
        permissions,
        stats: conversationStats[0]
      };

      return ResponseHelper.success(res, userDetail, '获取用户详情成功');
    } catch (error) {
      logger.error('获取用户详情失败', { 
        adminId: req.user?.id, 
        targetUserId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户详情失败');
    }
  }

  /**
   * 更新用户
   * PUT /api/admin/users/:id
   */
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { username, role, status, token_quota } = req.body;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 检查权限限制
      if (role && (role === 'admin' || role === 'super_admin')) {
        if (req.user.role !== 'super_admin') {
          return ResponseHelper.forbidden(res, '权限不足，无法设置管理员角色');
        }
      }

      // 不允许修改自己的角色和状态（防止误操作）
      if (id == req.user.id) {
        if (role && role !== user.role) {
          return ResponseHelper.validation(res, ['不能修改自己的角色']);
        }
        if (status && status !== user.status) {
          return ResponseHelper.validation(res, ['不能修改自己的状态']);
        }
      }

      // 更新用户信息
      const sql = `
        UPDATE users 
        SET username = ?, role = ?, status = ?, token_quota = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      await dbConnection.query(sql, [
        username || user.username,
        role || user.role,
        status || user.status,
        token_quota !== undefined ? parseInt(token_quota) : user.token_quota,
        id
      ]);

      const updatedUser = await User.findById(id);

      logger.info('管理员更新用户成功', { 
        adminId: req.user.id,
        targetUserId: id,
        changes: { username, role, status, token_quota }
      });

      return ResponseHelper.success(res, updatedUser.toJSON(), '用户更新成功');
    } catch (error) {
      logger.error('更新用户失败', { 
        adminId: req.user?.id, 
        targetUserId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '更新用户失败');
    }
  }

  /**
   * 删除用户
   * DELETE /api/admin/users/:id
   */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;

      // 不允许删除自己
      if (id == req.user.id) {
        return ResponseHelper.validation(res, ['不能删除自己的账户']);
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 只有超级管理员可以删除其他管理员
      if ((user.role === 'admin' || user.role === 'super_admin') && req.user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '权限不足，无法删除管理员账户');
      }

      // 删除用户（级联删除相关数据）
      await dbConnection.query('DELETE FROM users WHERE id = ?', [id]);

      logger.info('管理员删除用户成功', { 
        adminId: req.user.id,
        deletedUserId: id,
        deletedUserRole: user.role
      });

      return ResponseHelper.success(res, null, '用户删除成功');
    } catch (error) {
      logger.error('删除用户失败', { 
        adminId: req.user?.id, 
        targetUserId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '删除用户失败');
    }
  }

  /**
   * 获取AI模型管理
   * GET /api/admin/models
   */
  static async getAIModels(req, res) {
    try {
      const sql = `
        SELECT *, 
        (SELECT COUNT(*) FROM conversations WHERE model_name = ai_models.name) as usage_count
        FROM ai_models 
        ORDER BY sort_order ASC, created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      const models = rows.map(row => {
        const model = new AIModel(row);
        // 解析JSON配置
        if (typeof model.model_config === 'string') {
          try {
            model.model_config = JSON.parse(model.model_config);
          } catch (e) {
            model.model_config = {};
          }
        }
        return {
          ...model.toJSON(),
          usage_count: row.usage_count
        };
      });

      return ResponseHelper.success(res, models, '获取AI模型列表成功');
    } catch (error) {
      logger.error('获取AI模型列表失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取AI模型列表失败');
    }
  }

  /**
   * 创建AI模型配置
   * POST /api/admin/models
   */
  static async createAIModel(req, res) {
    try {
      const { 
        name, 
        display_name, 
        api_key,
        api_endpoint, 
        sort_order = 0 
      } = req.body;

      if (!name || !display_name || !api_key || !api_endpoint) {
        return ResponseHelper.validation(res, ['模型名称、显示名称、API密钥和API端点不能为空']);
      }

      const model = await AIModel.create({
        name,
        display_name,
        api_key,
        api_endpoint,
        sort_order: parseInt(sort_order)
      });

      logger.info('管理员创建AI模型成功', { 
        adminId: req.user.id,
        modelName: name,
        modelId: model.id
      });

      return ResponseHelper.success(res, model.toJSON(), 'AI模型创建成功', 201);
    } catch (error) {
      logger.error('创建AI模型失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message.includes('Duplicate') ? '模型名称已存在' : '创建AI模型失败');
    }
  }

  /**
   * 更新AI模型配置
   * PUT /api/admin/models/:id
   */
  static async updateAIModel(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      await model.update(updateData);
      const updatedModel = await AIModel.findById(id);

      logger.info('管理员更新AI模型成功', { 
        adminId: req.user.id,
        modelId: id
      });

      return ResponseHelper.success(res, updatedModel.toJSON(), 'AI模型更新成功');
    } catch (error) {
      logger.error('更新AI模型失败', { 
        adminId: req.user?.id, 
        modelId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '更新AI模型失败');
    }
  }

  /**
   * 测试AI模型连通性
   * POST /api/admin/models/:id/test
   */
  static async testAIModel(req, res) {
    try {
      const { id } = req.params;

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      const testResult = await model.testConnection();

      logger.info('AI模型连通性测试完成', { 
        adminId: req.user.id,
        modelId: id,
        success: testResult.success
      });

      return ResponseHelper.success(res, testResult, '连通性测试完成');
    } catch (error) {
      logger.error('AI模型连通性测试失败', { 
        adminId: req.user?.id, 
        modelId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, 'AI模型连通性测试失败');
    }
  }

  /**
   * 删除AI模型配置
   * DELETE /api/admin/models/:id
   */
  static async deleteAIModel(req, res) {
    try {
      const { id } = req.params;

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      // 检查是否有正在使用的对话
      const { rows: usageCheck } = await dbConnection.query(
        'SELECT COUNT(*) as count FROM conversations WHERE model_name = ?',
        [model.name]
      );

      if (usageCheck[0].count > 0) {
        return ResponseHelper.validation(res, ['该模型正在被使用，无法删除']);
      }

      await dbConnection.query('DELETE FROM ai_models WHERE id = ?', [id]);

      logger.info('管理员删除AI模型成功', { 
        adminId: req.user.id,
        modelId: id,
        modelName: model.name
      });

      return ResponseHelper.success(res, null, 'AI模型删除成功');
    } catch (error) {
      logger.error('删除AI模型失败', { 
        adminId: req.user?.id, 
        modelId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '删除AI模型失败');
    }
  }

  /**
   * 获取系统设置
   * GET /api/admin/settings
   */
  static async getSystemSettings(req, res) {
    try {
      // 模拟系统设置（实际应该从数据库或配置文件读取）
      const settings = {
        site: {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: {
          allow_register: true,
          email_verification: false,
          default_token_quota: 10000
        },
        ai: {
          default_model: 'gpt-3.5-turbo',
          max_tokens: 4096,
          temperature: 0.7
        },
        security: {
          session_timeout: 30,
          max_login_attempts: 5,
          enable_rate_limit: true
        }
      };

      return ResponseHelper.success(res, settings, '获取系统设置成功');
    } catch (error) {
      logger.error('获取系统设置失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取系统设置失败');
    }
  }

  /**
   * 更新系统设置
   * PUT /api/admin/settings
   */
  static async updateSystemSettings(req, res) {
    try {
      const settings = req.body;

      // TODO: 实际应该保存到数据库或配置文件
      // 这里只是模拟保存

      logger.info('管理员更新系统设置', { 
        adminId: req.user.id,
        settings
      });

      return ResponseHelper.success(res, settings, '系统设置更新成功');
    } catch (error) {
      logger.error('更新系统设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '更新系统设置失败');
    }
  }
}

module.exports = AdminController;
