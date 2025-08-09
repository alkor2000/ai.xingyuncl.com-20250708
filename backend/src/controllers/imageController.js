/**
 * 图像生成控制器
 */

const ImageService = require('../services/imageService');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class ImageController {
  /**
   * 获取可用的图像模型列表
   */
  static async getModels(req, res) {
    try {
      const models = await ImageService.getAvailableModels();
      
      // 不返回API密钥
      const safeModels = models.map(model => {
        const { api_key, ...safeModel } = model;
        return safeModel;
      });
      
      return ResponseHelper.success(res, safeModels);
    } catch (error) {
      logger.error('获取图像模型列表失败:', error);
      return ResponseHelper.error(res, '获取模型列表失败');
    }
  }

  /**
   * 生成图片（支持批量生成）
   */
  static async generateImage(req, res) {
    try {
      const userId = req.user.id;
      const { 
        model_id, 
        prompt, 
        negative_prompt, 
        size, 
        seed, 
        guidance_scale, 
        watermark,
        quantity = 1  // 新增：生成数量，默认1张
      } = req.body;
      
      // 验证必填参数
      if (!model_id || !prompt) {
        return ResponseHelper.validation(res, {
          model_id: !model_id ? '请选择模型' : null,
          prompt: !prompt ? '请输入提示词' : null
        }, '参数不完整');
      }
      
      // 验证参数（包括quantity）
      const errors = ImageService.validateGenerationParams(req.body);
      if (errors.length > 0) {
        return ResponseHelper.validation(res, null, errors.join('; '));
      }
      
      // 限制数量范围
      const actualQuantity = Math.min(Math.max(1, parseInt(quantity) || 1), 4);
      
      if (actualQuantity === 1) {
        // 单张生成（保持兼容性）
        const result = await ImageService.generateImage(userId, model_id, {
          prompt,
          negative_prompt,
          size,
          seed,
          guidance_scale,
          watermark
        });
        
        return ResponseHelper.success(res, result, '图片生成成功');
      } else {
        // 批量生成
        const result = await ImageService.generateImages(userId, model_id, {
          prompt,
          negative_prompt,
          size,
          seed,
          guidance_scale,
          watermark
        }, actualQuantity);
        
        if (result.succeeded > 0) {
          const message = `成功生成 ${result.succeeded}/${result.requested} 张图片，消耗 ${result.creditsConsumed} 积分`;
          return ResponseHelper.success(res, result, message);
        } else {
          return ResponseHelper.error(res, '所有图片生成失败');
        }
      }
    } catch (error) {
      logger.error('生成图片失败:', error);
      
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }
      
      return ResponseHelper.error(res, error.message || '图片生成失败');
    }
  }

  /**
   * 获取用户的生成历史
   */
  static async getUserHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status, is_favorite, model_id } = req.query;
      
      const result = await ImageGeneration.getUserHistory(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        is_favorite: is_favorite === 'true' ? 1 : is_favorite === 'false' ? 0 : null,
        model_id: model_id ? parseInt(model_id) : null
      });
      
      return ResponseHelper.success(res, result);
    } catch (error) {
      logger.error('获取生成历史失败:', error);
      return ResponseHelper.error(res, '获取历史记录失败');
    }
  }

  /**
   * 获取单个生成记录详情
   */
  static async getGeneration(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const generation = await ImageGeneration.findById(id);
      
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }
      
      // 验证权限（只能查看自己的或公开的）
      if (generation.user_id !== userId && !generation.is_public) {
        return ResponseHelper.forbidden(res, '无权查看此记录');
      }
      
      // 增加查看次数
      if (generation.is_public && generation.user_id !== userId) {
        await ImageGeneration.incrementViewCount(id);
      }
      
      return ResponseHelper.success(res, generation);
    } catch (error) {
      logger.error('获取生成记录失败:', error);
      return ResponseHelper.error(res, '获取记录失败');
    }
  }

  /**
   * 删除生成记录
   */
  static async deleteGeneration(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      // 获取记录信息
      const generation = await ImageGeneration.findById(id);
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }
      
      // 验证权限
      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权删除此记录');
      }
      
      // 删除文件
      await ImageService.deleteImageFile(generation.local_path, generation.thumbnail_path);
      
      // 删除记录
      const success = await ImageGeneration.delete(id, userId);
      
      if (!success) {
        return ResponseHelper.error(res, '删除失败');
      }
      
      return ResponseHelper.success(res, null, '删除成功');
    } catch (error) {
      logger.error('删除生成记录失败:', error);
      return ResponseHelper.error(res, '删除失败');
    }
  }

  /**
   * 批量删除生成记录
   */
  static async batchDeleteGenerations(req, res) {
    try {
      const { ids } = req.body;
      const userId = req.user.id;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return ResponseHelper.validation(res, { ids: '请选择要删除的记录' });
      }
      
      // 获取要删除的记录
      for (const id of ids) {
        const generation = await ImageGeneration.findById(id);
        if (generation && generation.user_id === userId) {
          // 删除文件
          await ImageService.deleteImageFile(generation.local_path, generation.thumbnail_path);
        }
      }
      
      // 批量删除记录
      const deletedCount = await ImageGeneration.batchDelete(ids, userId);
      
      return ResponseHelper.success(res, { deletedCount }, `成功删除 ${deletedCount} 条记录`);
    } catch (error) {
      logger.error('批量删除失败:', error);
      return ResponseHelper.error(res, '批量删除失败');
    }
  }

  /**
   * 切换收藏状态
   */
  static async toggleFavorite(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const success = await ImageGeneration.toggleFavorite(id, userId);
      
      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }
      
      return ResponseHelper.success(res, null, '操作成功');
    } catch (error) {
      logger.error('切换收藏状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }

  /**
   * 获取公开画廊
   */
  static async getPublicGallery(req, res) {
    try {
      const { page = 1, limit = 20, model_id } = req.query;
      
      const result = await ImageGeneration.getPublicGallery({
        page: parseInt(page),
        limit: parseInt(limit),
        model_id: model_id ? parseInt(model_id) : null
      });
      
      return ResponseHelper.success(res, result);
    } catch (error) {
      logger.error('获取公开画廊失败:', error);
      return ResponseHelper.error(res, '获取画廊失败');
    }
  }

  /**
   * 切换公开状态
   */
  static async togglePublic(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      // 获取记录
      const generation = await ImageGeneration.findById(id);
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }
      
      // 验证权限
      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权操作此记录');
      }
      
      // 切换公开状态
      const success = await ImageGeneration.update(id, {
        is_public: generation.is_public ? 0 : 1
      });
      
      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }
      
      return ResponseHelper.success(res, null, '操作成功');
    } catch (error) {
      logger.error('切换公开状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }

  /**
   * 获取用户统计信息
   */
  static async getUserStats(req, res) {
    try {
      const userId = req.user.id;
      const stats = await ImageGeneration.getUserStats(userId);
      
      return ResponseHelper.success(res, stats);
    } catch (error) {
      logger.error('获取统计信息失败:', error);
      return ResponseHelper.error(res, '获取统计信息失败');
    }
  }
}

// 管理端控制器
class ImageAdminController {
  /**
   * 获取所有图像模型（管理端）
   */
  static async getAllModels(req, res) {
    try {
      const models = await ImageModel.findAll();
      
      // 不返回解密的API密钥，只返回是否已配置
      const safeModels = models.map(model => {
        const { api_key, ...safeModel } = model;
        return {
          ...safeModel,
          has_api_key: !!api_key
        };
      });
      
      return ResponseHelper.success(res, safeModels);
    } catch (error) {
      logger.error('获取图像模型列表失败:', error);
      return ResponseHelper.error(res, '获取模型列表失败');
    }
  }

  /**
   * 创建图像模型
   */
  static async createModel(req, res) {
    try {
      const modelData = req.body;
      
      // 验证必填字段
      if (!modelData.name || !modelData.display_name || !modelData.endpoint || !modelData.model_id) {
        return ResponseHelper.validation(res, {
          name: !modelData.name ? '模型标识不能为空' : null,
          display_name: !modelData.display_name ? '显示名称不能为空' : null,
          endpoint: !modelData.endpoint ? 'API端点不能为空' : null,
          model_id: !modelData.model_id ? '模型ID不能为空' : null
        });
      }
      
      const modelId = await ImageModel.create(modelData);
      const newModel = await ImageModel.findById(modelId);
      
      return ResponseHelper.success(res, newModel, '模型创建成功');
    } catch (error) {
      logger.error('创建图像模型失败:', error);
      return ResponseHelper.error(res, '创建模型失败');
    }
  }

  /**
   * 更新图像模型
   */
  static async updateModel(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const success = await ImageModel.update(id, updateData);
      
      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }
      
      const updatedModel = await ImageModel.findById(id);
      return ResponseHelper.success(res, updatedModel, '模型更新成功');
    } catch (error) {
      logger.error('更新图像模型失败:', error);
      return ResponseHelper.error(res, '更新模型失败');
    }
  }

  /**
   * 删除图像模型
   */
  static async deleteModel(req, res) {
    try {
      const { id } = req.params;
      
      const success = await ImageModel.delete(id);
      
      if (!success) {
        return ResponseHelper.error(res, '删除失败');
      }
      
      return ResponseHelper.success(res, null, '模型删除成功');
    } catch (error) {
      logger.error('删除图像模型失败:', error);
      return ResponseHelper.error(res, '删除模型失败');
    }
  }

  /**
   * 切换模型状态
   */
  static async toggleModelStatus(req, res) {
    try {
      const { id } = req.params;
      
      const model = await ImageModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, '模型不存在');
      }
      
      const success = await ImageModel.update(id, {
        is_active: model.is_active ? 0 : 1
      });
      
      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }
      
      return ResponseHelper.success(res, null, '状态更新成功');
    } catch (error) {
      logger.error('切换模型状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }
}

module.exports = {
  ImageController,
  ImageAdminController
};
