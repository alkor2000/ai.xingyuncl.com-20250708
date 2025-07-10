/**
 * 管理员控制器 - 支持用户分组管理和积分管理
 */

const User = require('../models/User');
const AIModel = require('../models/AIModel');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const config = require('../config');
const dbConnection = require('../database/connection');

class AdminController {
  
  /**
   * 获取系统统计 - 包含分组统计和积分统计
   */
  static async getSystemStats(req, res) {
    try {
      // 获取用户统计
      const userStatsQuery = `
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN role = 'admin' OR role = 'super_admin' THEN 1 ELSE 0 END) as admin_users,
          SUM(used_tokens) as total_tokens_used,
          AVG(used_tokens) as avg_tokens_per_user,
          SUM(credits_quota) as total_credits_quota,
          SUM(used_credits) as total_credits_used,
          AVG(credits_quota - used_credits) as avg_credits_remaining
        FROM users
      `;
      const { rows: userStats } = await dbConnection.query(userStatsQuery);
      
      // 获取分组统计
      const groupStatsQuery = `
        SELECT g.name, g.color, COUNT(u.id) as user_count, 
               AVG(u.used_tokens) as avg_tokens,
               AVG(u.used_credits) as avg_credits,
               SUM(u.credits_quota - u.used_credits) as total_credits_remaining
        FROM user_groups g
        LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
        GROUP BY g.id
        ORDER BY g.sort_order ASC
      `;
      const { rows: groupStats } = await dbConnection.query(groupStatsQuery);
      
      // 获取对话统计
      const conversationStatsQuery = `
        SELECT 
          COUNT(*) as total_conversations,
          SUM(message_count) as total_messages,
          SUM(total_tokens) as conversation_tokens,
          AVG(message_count) as avg_messages_per_conversation
        FROM conversations
      `;
      const { rows: conversationStats } = await dbConnection.query(conversationStatsQuery);
      
      // 获取AI模型使用统计 (包含积分消费)
      const modelStatsQuery = `
        SELECT 
          am.display_name as model_name,
          am.credits_per_chat,
          COUNT(c.id) as conversation_count,
          SUM(c.total_tokens) as total_tokens,
          COUNT(ct.id) as credit_transactions,
          SUM(ABS(ct.amount)) as total_credits_consumed
        FROM ai_models am
        LEFT JOIN conversations c ON am.name = c.model_name 
        LEFT JOIN credit_transactions ct ON am.id = ct.related_model_id
        WHERE am.is_active = 1
        GROUP BY am.id
        ORDER BY conversation_count DESC
        LIMIT 10
      `;
      const { rows: modelStats } = await dbConnection.query(modelStatsQuery);

      const stats = {
        users: userStats[0] || {},
        groups: groupStats || [],
        conversations: conversationStats[0] || {},
        models: modelStats || []
      };

      logger.info('获取系统统计成功', { 
        adminId: req.user.id,
        stats: Object.keys(stats)
      });

      return ResponseHelper.success(res, stats, '获取系统统计成功');
    } catch (error) {
      logger.error('获取系统统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取系统统计失败');
    }
  }

  /**
   * 获取用户列表 - 支持分组过滤
   */
  static async getUsers(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        role = null, 
        status = null, 
        group_id = null,
        search = null 
      } = req.query;

      const result = await User.getList({
        page: parseInt(page),
        limit: parseInt(limit),
        role,
        status,
        group_id: group_id ? parseInt(group_id) : null,
        search
      });

      return ResponseHelper.paginated(res, result.users, result.pagination, '获取用户列表成功');
    } catch (error) {
      logger.error('获取用户列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户列表失败');
    }
  }

  /**
   * 获取用户详情 (包含积分信息)
   */
  static async getUserDetail(req, res) {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const permissions = await user.getPermissions();

      logger.info('获取用户详情成功', { 
        adminId: req.user.id,
        targetUserId: id
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions
      }, '获取用户详情成功');
    } catch (error) {
      logger.error('获取用户详情失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户详情失败');
    }
  }

  /**
   * 创建用户 - 支持分组设置和积分配额
   */
  static async createUser(req, res) {
    try {
      const { 
        email, 
        username, 
        password, 
        role = 'user', 
        group_id = null,
        status = 'active', 
        token_quota = 10000,
        credits_quota = 1000
      } = req.body;

      // 检查邮箱是否已存在
      const existingEmail = await User.findByEmail(email);
      if (existingEmail) {
        return ResponseHelper.badRequest(res, '邮箱已被使用');
      }

      // 检查用户名是否已存在
      const existingUsername = await User.findByUsername(username);
      if (existingUsername) {
        return ResponseHelper.badRequest(res, '用户名已被使用');
      }

      const user = await User.create({
        email,
        username,
        password,
        role,
        group_id: group_id || null,
        status,
        token_quota,
        credits_quota
      });

      logger.info('管理员创建用户成功', { 
        adminId: req.user.id,
        newUserId: user.id,
        email,
        role,
        group_id,
        credits_quota
      });

      return ResponseHelper.success(res, user.toJSON(), '用户创建成功', 201);
    } catch (error) {
      logger.error('创建用户失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '创建用户失败');
    }
  }

  /**
   * 更新用户 - 支持分组更新和积分配额
   */
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const updatedUser = await user.update(updateData);

      logger.info('管理员更新用户成功', { 
        adminId: req.user.id,
        targetUserId: id,
        updateFields: Object.keys(updateData)
      });

      return ResponseHelper.success(res, updatedUser.toJSON(), '用户更新成功');
    } catch (error) {
      logger.error('更新用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '更新用户失败');
    }
  }

  /**
   * 删除用户
   */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      await user.delete();

      logger.info('管理员删除用户成功', { 
        adminId: req.user.id,
        deletedUserId: id,
        deletedEmail: user.email
      });

      return ResponseHelper.success(res, null, '用户删除成功');
    } catch (error) {
      logger.error('删除用户失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '删除用户失败');
    }
  }

  // ===== 积分管理接口 (新增核心功能) =====

  /**
   * 获取用户积分信息
   * GET /api/admin/users/:id/credits
   */
  static async getUserCredits(req, res) {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const creditsInfo = {
        user_id: user.id,
        user_email: user.email,
        credits_quota: user.credits_quota,
        used_credits: user.used_credits,
        credits_stats: user.getCreditsStats()
      };

      logger.info('获取用户积分信息成功', { 
        adminId: req.user.id,
        targetUserId: id,
        creditsInfo
      });

      return ResponseHelper.success(res, creditsInfo, '获取用户积分信息成功');
    } catch (error) {
      logger.error('获取用户积分信息失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户积分信息失败');
    }
  }

  /**
   * 设置用户积分配额
   * PUT /api/admin/users/:id/credits
   */
  static async setUserCredits(req, res) {
    try {
      const { id } = req.params;
      const { credits_quota, reason = '管理员调整积分配额' } = req.body;
      
      if (typeof credits_quota !== 'number' || credits_quota < 0) {
        return ResponseHelper.badRequest(res, '积分配额必须是非负数字');
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await user.setCreditsQuota(credits_quota, reason, req.user.id);

      logger.info('管理员设置用户积分配额成功', { 
        adminId: req.user.id,
        targetUserId: id,
        newQuota: credits_quota,
        reason
      });

      return ResponseHelper.success(res, result, '积分配额设置成功');
    } catch (error) {
      logger.error('设置用户积分配额失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '设置积分配额失败');
    }
  }

  /**
   * 充值用户积分
   * POST /api/admin/users/:id/credits/add
   */
  static async addUserCredits(req, res) {
    try {
      const { id } = req.params;
      const { amount, reason = '管理员充值积分' } = req.body;
      
      if (typeof amount !== 'number' || amount <= 0) {
        return ResponseHelper.badRequest(res, '充值金额必须是正数');
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await user.addCredits(amount, reason, req.user.id);

      logger.info('管理员充值用户积分成功', { 
        adminId: req.user.id,
        targetUserId: id,
        amount,
        reason
      });

      return ResponseHelper.success(res, result, '积分充值成功');
    } catch (error) {
      logger.error('充值用户积分失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '积分充值失败');
    }
  }

  /**
   * 扣减用户积分
   * POST /api/admin/users/:id/credits/deduct
   */
  static async deductUserCredits(req, res) {
    try {
      const { id } = req.params;
      const { amount, reason = '管理员扣减积分' } = req.body;
      
      if (typeof amount !== 'number' || amount <= 0) {
        return ResponseHelper.badRequest(res, '扣减金额必须是正数');
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await user.deductCredits(amount, reason, req.user.id);

      logger.info('管理员扣减用户积分成功', { 
        adminId: req.user.id,
        targetUserId: id,
        amount,
        reason
      });

      return ResponseHelper.success(res, result, '积分扣减成功');
    } catch (error) {
      logger.error('扣减用户积分失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '积分扣减失败');
    }
  }

  /**
   * 获取用户积分使用历史
   * GET /api/admin/users/:id/credits/history
   */
  static async getUserCreditsHistory(req, res) {
    try {
      const { id } = req.params;
      const { 
        page = 1, 
        limit = 20, 
        transaction_type = null 
      } = req.query;

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await User.getCreditHistory(id, {
        page: parseInt(page),
        limit: parseInt(limit),
        transaction_type
      });

      logger.info('获取用户积分历史成功', { 
        adminId: req.user.id,
        targetUserId: id,
        historyCount: result.history.length
      });

      return ResponseHelper.paginated(res, result.history, result.pagination, '获取积分历史成功');
    } catch (error) {
      logger.error('获取用户积分历史失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取积分历史失败');
    }
  }

  // ===== 用户分组管理 (保持不变) =====

  /**
   * 获取用户分组列表
   */
  static async getUserGroups(req, res) {
    try {
      const groups = await User.getGroups();

      logger.info('获取用户分组列表成功', { 
        adminId: req.user.id,
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
   * 创建用户分组
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
   * 更新用户分组
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
   * 删除用户分组
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

  // ===== AI模型管理 (支持积分配置) =====

  /**
   * 获取AI模型列表
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
        if (typeof model.model_config === 'string') {
          try {
            model.model_config = JSON.parse(model.model_config);
          } catch (e) {
            model.model_config = {};
          }
        }
        return model;
      });

      logger.info('获取AI模型列表成功', { 
        adminId: req.user.id,
        modelCount: models.length
      });

      return ResponseHelper.success(res, models, '获取AI模型列表成功');
    } catch (error) {
      logger.error('获取AI模型列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取AI模型列表失败');
    }
  }

  /**
   * 创建AI模型
   */
  static async createAIModel(req, res) {
    try {
      const modelData = req.body;
      const model = await AIModel.create(modelData);

      logger.info('创建AI模型成功', { 
        adminId: req.user.id,
        modelId: model.id,
        modelName: model.name
      });

      return ResponseHelper.success(res, model, 'AI模型创建成功', 201);
    } catch (error) {
      logger.error('创建AI模型失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '创建AI模型失败');
    }
  }

  /**
   * 更新AI模型 (支持积分配置)
   */
  static async updateAIModel(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      const updatedModel = await model.update(updateData);

      logger.info('更新AI模型成功', { 
        adminId: req.user.id,
        modelId: id,
        updateFields: Object.keys(updateData)
      });

      return ResponseHelper.success(res, updatedModel, 'AI模型更新成功');
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
   * 删除AI模型
   */
  static async deleteAIModel(req, res) {
    try {
      const { id } = req.params;

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      await model.delete();

      logger.info('删除AI模型成功', { 
        adminId: req.user.id,
        deletedModelId: id,
        deletedModelName: model.name
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
   * 测试AI模型连通性
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
        testSuccess: testResult.success
      });

      return ResponseHelper.success(res, testResult, '连通性测试完成');
    } catch (error) {
      logger.error('AI模型连通性测试失败', { 
        adminId: req.user?.id, 
        modelId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '连通性测试失败');
    }
  }

  /**
   * 获取系统设置
   */
  static async getSystemSettings(req, res) {
    try {
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
          default_token_quota: 10000,
          default_group_id: 1,
          default_credits_quota: 1000
        },
        ai: {
          default_model: 'gpt-3.5-turbo',
          max_tokens: 4096,
          temperature: 0.7
        },
        credits: {
          enable_credits: true,
          default_credits: 1000,
          max_credits: 100000,
          min_credits_for_chat: 1
        },
        security: {
          session_timeout: 720,
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
   */
  static async updateSystemSettings(req, res) {
    try {
      const settings = req.body;

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

  /**
   * 获取系统模块列表
   */
  static async getModules(req, res) {
    try {
      const sql = `
        SELECT 
          id, name, display_name, description, module_type,
          api_endpoint, frontend_url, proxy_path, auth_mode,
          is_active, sort_order, permissions, config,
          health_check_url, status, last_check_at,
          created_at, updated_at
        FROM system_modules 
        ORDER BY sort_order ASC, created_at ASC
      `;
      
      const { rows: modules } = await dbConnection.query(sql);

      logger.info('获取系统模块列表成功', { 
        adminId: req.user.id,
        moduleCount: modules.length
      });

      return ResponseHelper.success(res, modules, '获取系统模块列表成功');
    } catch (error) {
      logger.error('获取系统模块列表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取系统模块列表失败');
    }
  }

  /**
   * 创建系统模块
   */
  static async createModule(req, res) {
    try {
      const {
        name,
        display_name,
        description,
        module_type = 'fullstack',
        api_endpoint,
        frontend_url,
        proxy_path,
        auth_mode = 'jwt',
        permissions = [],
        config = {}
      } = req.body;

      const sql = `
        INSERT INTO system_modules 
        (name, display_name, description, module_type, api_endpoint, frontend_url, 
         proxy_path, auth_mode, permissions, config, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 
          (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM system_modules m))
      `;
      
      const { rows } = await dbConnection.query(sql, [
        name, display_name, description, module_type,
        api_endpoint, frontend_url, proxy_path, auth_mode,
        JSON.stringify(permissions), JSON.stringify(config)
      ]);

      const moduleId = rows.insertId;

      logger.info('创建系统模块成功', { 
        adminId: req.user.id,
        moduleId,
        moduleName: name
      });

      const { rows: [newModule] } = await dbConnection.query(
        'SELECT * FROM system_modules WHERE id = ?', [moduleId]
      );

      return ResponseHelper.success(res, newModule, '系统模块创建成功', 201);
    } catch (error) {
      logger.error('创建系统模块失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '创建系统模块失败');
    }
  }

  /**
   * 更新系统模块
   */
  static async updateModule(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const allowedFields = [
        'display_name', 'description', 'module_type', 'api_endpoint',
        'frontend_url', 'proxy_path', 'auth_mode', 'is_active', 
        'sort_order', 'permissions', 'config', 'health_check_url'
      ];

      const updateFields = [];
      const updateValues = [];

      allowedFields.forEach(field => {
        if (updateData.hasOwnProperty(field)) {
          updateFields.push(`${field} = ?`);
          
          if (field === 'permissions' || field === 'config') {
            updateValues.push(JSON.stringify(updateData[field]));
          } else {
            updateValues.push(updateData[field]);
          }
        }
      });

      if (updateFields.length === 0) {
        return ResponseHelper.badRequest(res, '没有有效的更新字段');
      }

      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      updateValues.push(id);

      const sql = `UPDATE system_modules SET ${updateFields.join(', ')} WHERE id = ?`;
      await dbConnection.query(sql, updateValues);

      logger.info('更新系统模块成功', { 
        adminId: req.user.id,
        moduleId: id,
        updateFields: Object.keys(updateData)
      });

      const { rows: [updatedModule] } = await dbConnection.query(
        'SELECT * FROM system_modules WHERE id = ?', [id]
      );

      return ResponseHelper.success(res, updatedModule, '系统模块更新成功');
    } catch (error) {
      logger.error('更新系统模块失败', { 
        adminId: req.user?.id, 
        moduleId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '更新系统模块失败');
    }
  }

  /**
   * 删除系统模块
   */
  static async deleteModule(req, res) {
    try {
      const { id } = req.params;

      const { rows: [module] } = await dbConnection.query(
        'SELECT name FROM system_modules WHERE id = ?', [id]
      );

      if (!module) {
        return ResponseHelper.notFound(res, '系统模块不存在');
      }

      await dbConnection.query('DELETE FROM system_modules WHERE id = ?', [id]);

      logger.info('删除系统模块成功', { 
        adminId: req.user.id,
        deletedModuleId: id,
        deletedModuleName: module.name
      });

      return ResponseHelper.success(res, null, '系统模块删除成功');
    } catch (error) {
      logger.error('删除系统模块失败', { 
        adminId: req.user?.id, 
        moduleId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '删除系统模块失败');
    }
  }

  /**
   * 测试模块健康状态
   */
  static async checkModuleHealth(req, res) {
    try {
      const { id } = req.params;

      const { rows: [module] } = await dbConnection.query(
        'SELECT * FROM system_modules WHERE id = ?', [id]
      );

      if (!module) {
        return ResponseHelper.notFound(res, '系统模块不存在');
      }

      let status = 'unknown';
      let message = '未配置健康检查地址';

      if (module.health_check_url) {
        try {
          status = 'online';
          message = '模块运行正常';
        } catch (error) {
          status = 'offline';
          message = `健康检查失败: ${error.message}`;
        }
      }

      await dbConnection.query(
        'UPDATE system_modules SET status = ?, last_check_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id]
      );

      const result = { status, message, checked_at: new Date() };

      logger.info('模块健康检查完成', { 
        adminId: req.user.id,
        moduleId: id,
        status
      });

      return ResponseHelper.success(res, result, '模块健康检查完成');
    } catch (error) {
      logger.error('模块健康检查失败', { 
        adminId: req.user?.id, 
        moduleId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '模块健康检查失败');
    }
  }
}

module.exports = AdminController;
