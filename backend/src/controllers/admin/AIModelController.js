/**
 * AI模型管理控制器 - 支持基于角色的数据过滤、模型分组管理和拖拽排序
 * 
 * v1.1 新增 updateSortOrder 批量排序方法 - 2026-02-27
 */

const AIModel = require('../../models/AIModel');
const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const { ROLES } = require('../../middleware/permissions');
const CacheService = require('../../services/cacheService');

class AIModelController {
  /**
   * 获取AI模型列表 - 根据用户角色过滤敏感信息和模型列表
   */
  static async getAIModels(req, res) {
    try {
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      
      let sql;
      let params = [];
      
      if (userRole === ROLES.SUPER_ADMIN) {
        // 超级管理员看到所有模型
        sql = `
          SELECT m.*, 
          (SELECT COUNT(*) FROM conversations WHERE model_name = m.name) as usage_count,
          (SELECT COUNT(*) FROM ai_model_groups WHERE model_id = m.id) as assigned_groups_count
          FROM ai_models m
          ORDER BY m.sort_order ASC, m.created_at ASC
        `;
      } else if (userRole === ROLES.ADMIN) {
        // 组管理员只看到分配给本组的模型
        sql = `
          SELECT m.*, 
          (SELECT COUNT(*) FROM conversations WHERE model_name = m.name) as usage_count,
          1 as assigned_groups_count
          FROM ai_models m
          INNER JOIN ai_model_groups mg ON m.id = mg.model_id
          WHERE mg.group_id = ?
          ORDER BY m.sort_order ASC, m.created_at ASC
        `;
        params = [userGroupId];
      } else {
        // 普通用户不应该访问此接口
        return ResponseHelper.forbidden(res, '无权访问');
      }
      
      const { rows } = await dbConnection.query(sql, params);
      
      const models = rows.map(row => {
        const model = new AIModel(row);
        model.usage_count = row.usage_count;
        model.assigned_groups_count = row.assigned_groups_count;
        
        if (typeof model.model_config === 'string') {
          try {
            model.model_config = JSON.parse(model.model_config);
          } catch (e) {
            model.model_config = {};
          }
        }
        
        // 根据用户角色过滤敏感信息
        if (userRole === ROLES.ADMIN) {
          // 组管理员：隐藏敏感信息
          const filteredModel = {
            id: model.id,
            name: '******', // 隐藏真实模型名
            display_name: model.display_name,
            provider: model.provider,
            api_key: null, // 不返回API密钥
            api_endpoint: null, // 不返回API端点
            model_config: {}, // 不返回配置
            credits_per_chat: model.credits_per_chat,
            stream_enabled: model.stream_enabled,
            image_upload_enabled: model.image_upload_enabled,
            document_upload_enabled: model.document_upload_enabled,
            is_active: model.is_active,
            sort_order: model.sort_order,
            test_status: model.test_status,
            last_tested_at: model.last_tested_at,
            usage_count: model.usage_count,
            assigned_groups_count: model.assigned_groups_count,
            created_at: model.created_at,
            updated_at: model.updated_at
          };
          return filteredModel;
        }
        
        // 超级管理员：返回完整信息
        return model;
      });

      logger.info('获取AI模型列表成功', { 
        adminId: req.user.id,
        userRole: userRole,
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
   * 创建AI模型 - 只有超级管理员可以操作
   */
  static async createAIModel(req, res) {
    try {
      const modelData = req.body;
      const model = await AIModel.create(modelData);

      // 新建模型默认分配给所有激活的用户组
      const { rows: activeGroups } = await dbConnection.query(
        'SELECT id FROM user_groups WHERE is_active = 1'
      );
      
      if (activeGroups.length > 0) {
        const groupIds = activeGroups.map(g => g.id);
        await AIModel.updateModelGroups(model.id, groupIds, req.user.id);
      }

      logger.info('创建AI模型成功', { 
        adminId: req.user.id,
        modelId: model.id,
        modelName: model.name,
        assignedGroups: activeGroups.length
      });

      // 清除AI模型缓存
      await CacheService.clearAIModelsCache();
      
      return ResponseHelper.success(res, model.toJSON(), 'AI模型创建成功', 201);
    } catch (error) {
      logger.error('创建AI模型失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '创建AI模型失败');
    }
  }

  /**
   * 更新AI模型 - 只有超级管理员可以操作
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
      if (!updatedModel) {
        logger.error('更新后重新获取模型失败', { modelId: id });
        return ResponseHelper.error(res, '更新后获取模型数据失败');
      }

      logger.info('更新AI模型成功', { 
        adminId: req.user.id,
        modelId: id,
        updateFields: Object.keys(updateData),
        streamEnabled: updatedModel.stream_enabled,
        documentUploadEnabled: updatedModel.document_upload_enabled
      });

      // 清除AI模型缓存
      await CacheService.clearAIModelsCache();
      
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
   * 删除AI模型 - 只有超级管理员可以操作
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

      // 清除AI模型缓存
      await CacheService.clearAIModelsCache();
      
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
   * 测试AI模型连通性 - 超级管理员和组管理员都可以操作
   */
  static async testAIModel(req, res) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      // 组管理员不能测试连通性（因为看不到API密钥）
      if (userRole === ROLES.ADMIN) {
        return ResponseHelper.success(res, {
          success: true,
          message: '组管理员无法执行连通性测试'
        }, '操作完成');
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
   * 获取模型已分配的用户组 - 只有超级管理员可以操作
   */
  static async getModelGroups(req, res) {
    try {
      const { id } = req.params;
      
      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      const groups = await AIModel.getModelGroups(id);

      logger.info('获取模型分配组成功', {
        adminId: req.user.id,
        modelId: id,
        groupCount: groups.length
      });

      return ResponseHelper.success(res, groups, '获取模型分配组成功');
    } catch (error) {
      logger.error('获取模型分配组失败', {
        adminId: req.user?.id,
        modelId: req.params.id,
        error: error.message
      });
      return ResponseHelper.error(res, '获取模型分配组失败');
    }
  }

  /**
   * 更新模型的用户组分配 - 只有超级管理员可以操作
   */
  static async updateModelGroups(req, res) {
    try {
      const { id } = req.params;
      const { group_ids } = req.body;

      if (!Array.isArray(group_ids)) {
        return ResponseHelper.validation(res, ['group_ids 必须是数组']);
      }

      const model = await AIModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, 'AI模型不存在');
      }

      // 验证所有组ID是否存在
      if (group_ids.length > 0) {
        const { rows } = await dbConnection.query(
          `SELECT COUNT(*) as count FROM user_groups WHERE id IN (${group_ids.map(() => '?').join(',')})`,
          group_ids
        );
        
        if (rows[0].count !== group_ids.length) {
          return ResponseHelper.validation(res, ['部分用户组不存在']);
        }
      }

      // 更新分配关系
      await AIModel.updateModelGroups(id, group_ids, req.user.id);

      // 获取更新后的分配信息
      const updatedGroups = await AIModel.getModelGroups(id);

      logger.info('更新模型分配组成功', {
        adminId: req.user.id,
        modelId: id,
        groupIds: group_ids,
        updatedCount: updatedGroups.length
      });

      // 清除AI模型缓存（组分配变更影响用户可用模型）
      await CacheService.clearAIModelsCache();
      
      return ResponseHelper.success(res, {
        model_id: id,
        groups: updatedGroups,
        group_count: updatedGroups.length
      }, '模型分配组更新成功');
    } catch (error) {
      logger.error('更新模型分配组失败', {
        adminId: req.user?.id,
        modelId: req.params.id,
        error: error.message
      });
      return ResponseHelper.error(res, '更新模型分配组失败');
    }
  }

  /**
   * v1.1 批量更新模型排序 - 支持前端拖拽排序
   * 
   * @param {Object} req.body.sort_orders - 排序数组 [{id: 1, sort_order: 0}, {id: 2, sort_order: 1}, ...]
   */
  static async updateSortOrder(req, res) {
    try {
      const { sort_orders } = req.body;

      // 参数校验
      if (!Array.isArray(sort_orders) || sort_orders.length === 0) {
        return ResponseHelper.validation(res, ['sort_orders 必须是非空数组']);
      }

      // 校验每个元素格式
      for (const item of sort_orders) {
        if (!item.id || typeof item.sort_order !== 'number') {
          return ResponseHelper.validation(res, ['每个排序项必须包含 id 和 sort_order(数字)']);
        }
      }

      // 执行批量排序更新
      await AIModel.batchUpdateSortOrder(sort_orders);

      logger.info('批量更新模型排序成功', {
        adminId: req.user.id,
        modelCount: sort_orders.length
      });

      // 清除AI模型缓存
      await CacheService.clearAIModelsCache();

      return ResponseHelper.success(res, null, '模型排序更新成功');
    } catch (error) {
      logger.error('批量更新模型排序失败', {
        adminId: req.user?.id,
        error: error.message
      });
      return ResponseHelper.error(res, '模型排序更新失败');
    }
  }
}

module.exports = AIModelController;
