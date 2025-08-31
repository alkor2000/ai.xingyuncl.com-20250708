/**
 * 视频生成控制器
 */

const VideoService = require('../services/videoService');
const VideoModel = require('../models/VideoModel');
const VideoGeneration = require('../models/VideoGeneration');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class VideoController {
  /**
   * 获取可用的视频模型列表
   */
  static async getModels(req, res) {
    try {
      const models = await VideoService.getAvailableModels();
      
      // 不返回API密钥
      const safeModels = models.map(model => {
        const { api_key, ...safeModel } = model;
        return safeModel;
      });
      
      return ResponseHelper.success(res, safeModels);
    } catch (error) {
      logger.error('获取视频模型列表失败:', error);
      return ResponseHelper.error(res, '获取模型列表失败');
    }
  }

  /**
   * 提交视频生成任务
   */
  static async generateVideo(req, res) {
    try {
      const userId = req.user.id;
      const { 
        model_id, 
        prompt,
        negative_prompt,
        first_frame_image,
        last_frame_image,
        generation_mode = 'text_to_video',
        resolution,
        duration,
        fps,
        ratio,
        seed,
        watermark,
        camera_fixed,
        return_last_frame
      } = req.body;
      
      // 验证必填参数
      if (!model_id || !prompt) {
        return ResponseHelper.validation(res, {
          model_id: !model_id ? '请选择模型' : null,
          prompt: !prompt ? '请输入提示词' : null
        }, '参数不完整');
      }
      
      // 获取模型信息
      const model = await VideoModel.findById(model_id);
      if (!model) {
        return ResponseHelper.notFound(res, '模型不存在');
      }
      
      // 验证生成模式
      if (generation_mode === 'first_frame' && !model.supports_first_frame) {
        return ResponseHelper.validation(res, null, '该模型不支持首帧图生视频');
      }
      
      if ((generation_mode === 'last_frame' || generation_mode === 'first_last_frame') && !model.supports_last_frame) {
        return ResponseHelper.validation(res, null, '该模型不支持尾帧图生视频');
      }
      
      // 验证参数
      const errors = VideoService.validateGenerationParams(req.body, model);
      if (errors.length > 0) {
        return ResponseHelper.validation(res, null, errors.join('; '));
      }
      
      // 提交生成任务
      const result = await VideoService.submitVideoGeneration(userId, model_id, {
        prompt,
        negative_prompt,
        first_frame_image,
        last_frame_image,
        generation_mode,
        resolution,
        duration,
        fps,
        ratio,
        seed,
        watermark,
        camera_fixed,
        return_last_frame
      });
      
      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('生成视频失败:', error);
      
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }
      
      return ResponseHelper.error(res, error.message || '视频生成失败');
    }
  }
  
  /**
   * 查询任务状态
   */
  static async getTaskStatus(req, res) {
    try {
      const { task_id } = req.params;
      const userId = req.user.id;
      
      // 根据task_id查询生成记录
      const generation = await VideoGeneration.findByTaskId(task_id);
      
      if (!generation) {
        return ResponseHelper.notFound(res, '任务不存在');
      }
      
      // 验证权限
      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权查看此任务');
      }
      
      // 重要修改：始终先获取数据库的最新状态
      const latestGeneration = await VideoGeneration.findByTaskId(task_id);
      
      // 如果任务已完成（成功或失败），直接返回数据库中的完整数据
      if (latestGeneration.status === 'succeeded' || latestGeneration.status === 'failed') {
        logger.info('返回已完成任务的数据库状态', {
          taskId: task_id,
          status: latestGeneration.status,
          hasLocalPath: !!latestGeneration.local_path
        });
        
        return ResponseHelper.success(res, {
          id: latestGeneration.id,
          task_id: latestGeneration.task_id,
          status: latestGeneration.status,
          progress: 100,
          video_url: latestGeneration.video_url,
          local_path: latestGeneration.local_path,
          thumbnail_path: latestGeneration.thumbnail_path,
          preview_gif_path: latestGeneration.preview_gif_path,
          error_message: latestGeneration.error_message,
          prompt: latestGeneration.prompt,
          resolution: latestGeneration.resolution,
          duration: latestGeneration.duration,
          credits_consumed: latestGeneration.credits_consumed,
          created_at: latestGeneration.created_at,
          updated_at: latestGeneration.updated_at,
          completed_at: latestGeneration.completed_at
        });
      }
      
      // 如果任务还在进行中，尝试查询火山方舟API的最新状态
      if (latestGeneration.status === 'submitted' || latestGeneration.status === 'queued' || latestGeneration.status === 'running') {
        try {
          const model = await VideoModel.findById(latestGeneration.model_id);
          if (model) {
            const taskData = await VideoService.queryTaskStatus(task_id, model);
            
            // 如果火山方舟返回成功但数据库还没更新，等待数据库更新
            if (taskData.status === 'succeeded' && !latestGeneration.local_path) {
              logger.info('火山方舟返回成功但数据库未更新，返回处理中状态', {
                taskId: task_id
              });
              
              // 返回处理中状态，让前端继续轮询
              return ResponseHelper.success(res, {
                id: latestGeneration.id,
                task_id: latestGeneration.task_id,
                status: 'running',
                progress: 95, // 显示接近完成
                video_url: null,
                local_path: null,
                thumbnail_path: null,
                prompt: latestGeneration.prompt,
                resolution: latestGeneration.resolution,
                duration: latestGeneration.duration,
                created_at: latestGeneration.created_at,
                updated_at: latestGeneration.updated_at
              });
            }
            
            // 返回合并后的状态
            return ResponseHelper.success(res, {
              id: latestGeneration.id,
              task_id: latestGeneration.task_id,
              status: taskData.status || latestGeneration.status,
              progress: taskData.progress ? parseInt(taskData.progress * 100) : latestGeneration.progress,
              video_url: taskData.video_url || latestGeneration.video_url,
              local_path: latestGeneration.local_path,
              thumbnail_path: latestGeneration.thumbnail_path,
              prompt: latestGeneration.prompt,
              resolution: latestGeneration.resolution,
              duration: latestGeneration.duration,
              created_at: latestGeneration.created_at,
              updated_at: latestGeneration.updated_at
            });
          }
        } catch (error) {
          logger.warn('查询视频任务状态失败，返回数据库状态', { task_id, error: error.message });
        }
      }
      
      // 默认返回数据库中的状态
      return ResponseHelper.success(res, latestGeneration);
    } catch (error) {
      logger.error('获取任务状态失败:', error);
      return ResponseHelper.error(res, '获取任务状态失败');
    }
  }

  /**
   * 获取用户的生成历史
   */
  static async getUserHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status, is_favorite, model_id } = req.query;
      
      const result = await VideoGeneration.getUserHistory(userId, {
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
      
      const generation = await VideoGeneration.findById(id);
      
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }
      
      // 验证权限（只能查看自己的或公开的）
      if (generation.user_id !== userId && !generation.is_public) {
        return ResponseHelper.forbidden(res, '无权查看此记录');
      }
      
      // 增加查看次数
      if (generation.is_public && generation.user_id !== userId) {
        await VideoGeneration.incrementViewCount(id);
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
      const generation = await VideoGeneration.findById(id);
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }
      
      // 验证权限
      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权删除此记录');
      }
      
      // 删除文件
      await VideoService.deleteVideoFile(
        generation.local_path, 
        generation.thumbnail_path,
        generation.preview_gif_path
      );
      
      // 删除记录
      const success = await VideoGeneration.delete(id, userId);
      
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
      
      // 获取要删除的记录并删除文件
      for (const id of ids) {
        const generation = await VideoGeneration.findById(id);
        if (generation && generation.user_id === userId) {
          await VideoService.deleteVideoFile(
            generation.local_path,
            generation.thumbnail_path,
            generation.preview_gif_path
          );
        }
      }
      
      // 批量删除记录
      const deletedCount = await VideoGeneration.batchDelete(ids, userId);
      
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
      
      const success = await VideoGeneration.toggleFavorite(id, userId);
      
      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }
      
      // 获取更新后的状态
      const generation = await VideoGeneration.findById(id);
      
      return ResponseHelper.success(res, { 
        is_favorite: generation.is_favorite 
      }, '操作成功');
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
      
      const result = await VideoGeneration.getPublicGallery({
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
      const generation = await VideoGeneration.findById(id);
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }
      
      // 验证权限
      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权操作此记录');
      }
      
      // 切换公开状态
      const newPublicStatus = generation.is_public ? 0 : 1;
      const success = await VideoGeneration.update(id, {
        is_public: newPublicStatus
      });
      
      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }
      
      return ResponseHelper.success(res, { 
        is_public: newPublicStatus === 1 
      }, '操作成功');
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
      const stats = await VideoGeneration.getUserStats(userId);
      
      return ResponseHelper.success(res, stats);
    } catch (error) {
      logger.error('获取统计信息失败:', error);
      return ResponseHelper.error(res, '获取统计信息失败');
    }
  }
}

// 管理端控制器
class VideoAdminController {
  /**
   * 获取所有视频模型（管理端）
   */
  static async getAllModels(req, res) {
    try {
      const models = await VideoModel.findAll();
      return ResponseHelper.success(res, models);
    } catch (error) {
      logger.error('获取视频模型列表失败:', error);
      return ResponseHelper.error(res, '获取模型列表失败');
    }
  }

  /**
   * 创建视频模型
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
      
      const modelId = await VideoModel.create(modelData);
      const newModel = await VideoModel.findById(modelId);
      
      // 添加has_api_key标识
      const safeModel = { ...newModel };
      delete safeModel.api_key;
      safeModel.has_api_key = !!newModel.api_key;
      
      return ResponseHelper.success(res, safeModel, '模型创建成功');
    } catch (error) {
      logger.error('创建视频模型失败:', error);
      return ResponseHelper.error(res, '创建模型失败');
    }
  }

  /**
   * 更新视频模型
   */
  static async updateModel(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const success = await VideoModel.update(id, updateData);
      
      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }
      
      const updatedModel = await VideoModel.findById(id);
      
      // 添加has_api_key标识
      const safeModel = { ...updatedModel };
      delete safeModel.api_key;
      safeModel.has_api_key = !!updatedModel.api_key;
      
      return ResponseHelper.success(res, safeModel, '模型更新成功');
    } catch (error) {
      logger.error('更新视频模型失败:', error);
      return ResponseHelper.error(res, '更新模型失败');
    }
  }

  /**
   * 删除视频模型
   */
  static async deleteModel(req, res) {
    try {
      const { id } = req.params;
      
      const success = await VideoModel.delete(id);
      
      if (!success) {
        return ResponseHelper.error(res, '删除失败');
      }
      
      return ResponseHelper.success(res, null, '模型删除成功');
    } catch (error) {
      logger.error('删除视频模型失败:', error);
      return ResponseHelper.error(res, '删除模型失败');
    }
  }

  /**
   * 切换模型状态
   */
  static async toggleModelStatus(req, res) {
    try {
      const { id } = req.params;
      
      const model = await VideoModel.findById(id);
      if (!model) {
        return ResponseHelper.notFound(res, '模型不存在');
      }
      
      const success = await VideoModel.update(id, {
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
  VideoController,
  VideoAdminController
};
