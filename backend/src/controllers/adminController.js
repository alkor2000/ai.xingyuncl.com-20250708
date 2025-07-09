/**
 * 管理员控制器
 */

const User = require('../models/User');
const AIModel = require('../models/AIModel');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const config = require('../config');
const dbConnection = require('../database/connection');

class AdminController {
  
  /**
   * 获取系统统计
   * GET /api/admin/stats
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
          AVG(used_tokens) as avg_tokens_per_user
        FROM users
      `;
      
      const { rows: userStats } = await dbConnection.query(userStatsQuery);
      
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
      
      // 获取AI模型使用统计
      const modelStatsQuery = `
        SELECT 
          model_name,
          COUNT(*) as conversation_count,
          SUM(total_tokens) as total_tokens
        FROM conversations 
        GROUP BY model_name 
        ORDER BY conversation_count DESC
        LIMIT 10
      `;
      
      const { rows: modelStats } = await dbConnection.query(modelStatsQuery);

      const stats = {
        users: userStats[0] || {},
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
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户列表失败');
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

      // 获取用户权限
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
   * 创建用户
   * POST /api/admin/users
   */
  static async createUser(req, res) {
    try {
      const { email, username, password, role = 'user', status = 'active', token_quota = 10000 } = req.body;

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
        status,
        token_quota
      });

      logger.info('管理员创建用户成功', { 
        adminId: req.user.id,
        newUserId: user.id,
        email,
        role
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
   * 更新用户
   * PUT /api/admin/users/:id
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
   * DELETE /api/admin/users/:id
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

  /**
   * 获取AI模型列表 - 修复方法调用
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
   * POST /api/admin/models
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
   * 更新AI模型
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
   * DELETE /api/admin/models/:id
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
          session_timeout: 720, // 12小时
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

  /**
   * 获取系统模块列表
   * GET /api/admin/modules
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
   * POST /api/admin/modules
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

      // 返回创建的模块信息
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
   * PUT /api/admin/modules/:id
   */
  static async updateModule(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // 构建更新字段
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

      // 返回更新后的模块信息
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
   * DELETE /api/admin/modules/:id  
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
   * POST /api/admin/modules/:id/health-check
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
          // 这里应该实际发送HTTP请求检查模块状态
          // const response = await axios.get(module.health_check_url, { timeout: 5000 });
          // status = response.status === 200 ? 'online' : 'error';
          // message = response.data?.message || '健康检查通过';
          
          // 模拟检查结果
          status = 'online';
          message = '模块运行正常';
        } catch (error) {
          status = 'offline';
          message = `健康检查失败: ${error.message}`;
        }
      }

      // 更新模块状态
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
