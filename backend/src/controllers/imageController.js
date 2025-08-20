/**
 * 图像生成控制器
 */

const ImageService = require('../services/imageService');
const MidjourneyService = require('../services/midjourneyService');
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
   * 生成图片（支持批量生成和Midjourney）
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
        quantity = 1,  // 生成数量
        mode = 'fast'  // Midjourney模式
      } = req.body;
      
      // 验证必填参数
      if (!model_id || !prompt) {
        return ResponseHelper.validation(res, {
          model_id: !model_id ? '请选择模型' : null,
          prompt: !prompt ? '请输入提示词' : null
        }, '参数不完整');
      }
      
      // 获取模型信息
      const model = await ImageModel.findById(model_id);
      if (!model) {
        return ResponseHelper.notFound(res, '模型不存在');
      }
      
      // 判断是否为Midjourney模型
      if (model.provider === 'midjourney' && model.generation_type === 'async') {
        // 使用Midjourney服务
        const result = await MidjourneyService.submitImagine(userId, model_id, {
          prompt,
          negative_prompt,
          size,
          mode
        });
        
        return ResponseHelper.success(res, result, result.message);
      } else {
        // 使用普通图像服务（豆包等同步模型）
        // 验证参数
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
   * Midjourney操作（U/V/Reroll等）
   */
  static async midjourneyAction(req, res) {
    try {
      const userId = req.user.id;
      const { generation_id, action, index } = req.body;
      
      // 验证参数
      if (!generation_id || !action) {
        return ResponseHelper.validation(res, {
          generation_id: !generation_id ? '请提供生成记录ID' : null,
          action: !action ? '请提供操作类型' : null
        });
      }
      
      // 验证操作类型
      const validActions = ['UPSCALE', 'VARIATION', 'REROLL'];
      if (!validActions.includes(action)) {
        return ResponseHelper.validation(res, { action: '无效的操作类型' });
      }
      
      // 对于U/V操作，需要index
      if ((action === 'UPSCALE' || action === 'VARIATION') && (!index || index < 1 || index > 4)) {
        return ResponseHelper.validation(res, { index: '请提供有效的图片索引(1-4)' });
      }
      
      const result = await MidjourneyService.submitAction(userId, generation_id, action, index);
      
      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('Midjourney操作失败:', error);
      
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }
      
      return ResponseHelper.error(res, error.message || '操作失败');
    }
  }
  
  /**
   * 查询Midjourney任务状态
   */
  static async getMidjourneyTaskStatus(req, res) {
    try {
      const { task_id } = req.params;
      const userId = req.user.id;
      
      // 根据task_id查询生成记录（修复查询）
      const generation = await ImageGeneration.findByTaskId(task_id);
      
      if (!generation) {
        return ResponseHelper.notFound(res, '任务不存在');
      }
      
      // 验证权限
      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权查看此任务');
      }
      
      // 如果任务还在进行中，尝试查询最新状态
      if (generation.task_status === 'SUBMITTED' || generation.task_status === 'IN_PROGRESS') {
        try {
          const model = await ImageModel.findById(generation.model_id);
          if (model) {
            const taskData = await MidjourneyService.fetchTaskStatus(task_id, model);
            
            // 返回最新状态和当前数据
            return ResponseHelper.success(res, {
              id: generation.id,
              task_id: generation.task_id,
              status: generation.status,
              task_status: taskData.status || generation.task_status,
              progress: taskData.progress || generation.progress,
              image_url: taskData.imageUrl || generation.image_url,
              local_path: generation.local_path,
              thumbnail_path: generation.thumbnail_path,
              buttons: generation.buttons,
              prompt: generation.prompt,
              created_at: generation.created_at,
              updated_at: generation.updated_at
            });
          }
        } catch (error) {
          // 如果查询失败，返回数据库中的状态
          logger.warn('查询Midjourney任务状态失败，返回缓存状态', { task_id, error: error.message });
        }
      }
      
      // 返回数据库中的状态
      return ResponseHelper.success(res, generation);
    } catch (error) {
      logger.error('获取任务状态失败:', error);
      return ResponseHelper.error(res, '获取任务状态失败');
    }
  }
  
  /**
   * 获取用户的Midjourney任务列表
   */
  static async getMidjourneyTasks(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status } = req.query;
      
      const result = await MidjourneyService.getUserTasks(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        status
      });
      
      return ResponseHelper.success(res, result);
    } catch (error) {
      logger.error('获取Midjourney任务列表失败:', error);
      return ResponseHelper.error(res, '获取任务列表失败');
    }
  }
  
  /**
   * Webhook接收（用于Midjourney回调）
   */
  static async webhook(req, res) {
    try {
      const data = req.body;
      
      // 验证webhook密钥（如果配置了）
      const webhookSecret = process.env.MIDJOURNEY_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers['x-webhook-signature'];
        // TODO: 验证签名
      }
      
      // 处理回调
      const success = await MidjourneyService.handleWebhook(data);
      
      if (success) {
        return ResponseHelper.success(res, null, 'Webhook处理成功');
      } else {
        return ResponseHelper.error(res, 'Webhook处理失败');
      }
    } catch (error) {
      logger.error('处理Webhook失败:', error);
      return ResponseHelper.error(res, 'Webhook处理失败');
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
   * 获取所有图像模型（管理端）- 修复：直接返回模型，不重复处理has_api_key
   */
  static async getAllModels(req, res) {
    try {
      // ImageModel.findAll()已经正确处理了：移除api_key，添加has_api_key
      const models = await ImageModel.findAll();
      
      // 直接返回，不再重复处理
      return ResponseHelper.success(res, models);
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
      
      // 添加has_api_key标识
      const safeModel = { ...newModel };
      delete safeModel.api_key;
      safeModel.has_api_key = !!newModel.api_key;
      
      return ResponseHelper.success(res, safeModel, '模型创建成功');
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
      
      // 添加has_api_key标识
      const safeModel = { ...updatedModel };
      delete safeModel.api_key;
      safeModel.has_api_key = !!updatedModel.api_key;
      
      return ResponseHelper.success(res, safeModel, '模型更新成功');
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
