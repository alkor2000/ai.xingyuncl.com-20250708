/**
 * AI模型管理控制器 - 负责AI模型的配置管理
 */

const AIModel = require('../../models/AIModel');
const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class AIModelController {
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
   * 更新AI模型
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
        streamEnabled: updatedModel.stream_enabled
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
}

module.exports = AIModelController;
