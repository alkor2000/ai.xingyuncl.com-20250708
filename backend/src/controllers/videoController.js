/**
 * 视频生成控制器
 *
 * v1.1 新增 keyword 关键词搜索透传
 *   - getUserHistory 透传 req.query.keyword
 *   - getPublicGallery 透传 req.query.keyword
 *
 * 安全说明（用户端 getModels）：
 *   VideoModel.findAll 返回的对象虽已 delete api_key，但仍保留解析后的 api_config 字段，
 *   而可灵(kling)的真实密钥 access_key/secret_key 就存放在 api_config 内。
 *   因此用户端 /video/models 必须按【白名单】显式挑选前端所需的非敏感字段返回，
 *   绝不可用 { ...model } 或仅解构剔除 api_key 的黑名单方式——否则 api_config 连同
 *   可灵双密钥会明文透传给任何登录用户。后端真正调用视频 API 所需的密钥由
 *   VideoService 经 VideoModel.findById（另一条链路）读取，与本接口无关，
 *   故白名单不含密钥不影响生成功能。
 */

const VideoService = require('../services/videoService');
const VideoModel = require('../models/VideoModel');
const VideoGeneration = require('../models/VideoGeneration');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class VideoController {
  static async getModels(req, res) {
    try {
      const models = await VideoService.getAvailableModels();
      // 白名单：仅返回前端选择/展示/参数计算所需的非敏感字段，
      // 显式排除 api_key、api_config（含可灵 access_key/secret_key）、endpoint 等敏感/内部字段
      const safeModels = models.map(model => ({
        id: model.id,
        name: model.name,
        display_name: model.display_name,
        description: model.description,
        provider: model.provider,
        model_id: model.model_id,
        generation_type: model.generation_type,
        supports_text_to_video: model.supports_text_to_video,
        supports_image_to_video: model.supports_image_to_video,
        supports_first_frame: model.supports_first_frame,
        supports_last_frame: model.supports_last_frame,
        resolutions_supported: model.resolutions_supported,
        durations_supported: model.durations_supported,
        fps_supported: model.fps_supported,
        ratios_supported: model.ratios_supported,
        max_prompt_length: model.max_prompt_length,
        default_resolution: model.default_resolution,
        default_duration: model.default_duration,
        default_fps: model.default_fps,
        default_ratio: model.default_ratio,
        base_price: model.base_price,
        price_config: model.price_config,
        example_prompt: model.example_prompt,
        example_video: model.example_video,
        icon: model.icon,
        is_active: model.is_active,
        sort_order: model.sort_order,
        // has_api_key 由 VideoModel.findAll 计算（kling 查 api_config，其他查 api_key），
        // 前端仅据此布尔值判断"是否已配置"，无需也不应拿到密钥本身
        has_api_key: model.has_api_key
      }));
      return ResponseHelper.success(res, safeModels);
    } catch (error) {
      logger.error('获取视频模型列表失败:', error);
      return ResponseHelper.error(res, '获取模型列表失败');
    }
  }

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

      if (!model_id || !prompt) {
        return ResponseHelper.validation(res, {
          model_id: !model_id ? '请选择模型' : null,
          prompt: !prompt ? '请输入提示词' : null
        }, '参数不完整');
      }

      const model = await VideoModel.findById(model_id);
      if (!model) {
        return ResponseHelper.notFound(res, '模型不存在');
      }

      if (generation_mode === 'first_frame' && !model.supports_first_frame) {
        return ResponseHelper.validation(res, null, '该模型不支持首帧图生视频');
      }

      if ((generation_mode === 'last_frame' || generation_mode === 'first_last_frame') && !model.supports_last_frame) {
        return ResponseHelper.validation(res, null, '该模型不支持尾帧图生视频');
      }

      const errors = VideoService.validateGenerationParams(req.body, model);
      if (errors.length > 0) {
        return ResponseHelper.validation(res, null, errors.join('; '));
      }

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

  static async getTaskStatus(req, res) {
    try {
      const { task_id } = req.params;
      const userId = req.user.id;

      const generation = await VideoGeneration.findByTaskId(task_id);

      if (!generation) {
        return ResponseHelper.notFound(res, '任务不存在');
      }

      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权查看此任务');
      }

      if (generation.status === 'succeeded' || generation.status === 'failed') {
        logger.info('返回已完成任务的数据库状态', {
          taskId: task_id,
          status: generation.status,
          hasLocalPath: !!generation.local_path
        });

        return ResponseHelper.success(res, {
          id: generation.id,
          task_id: generation.task_id,
          status: generation.status,
          progress: 100,
          video_url: generation.video_url,
          local_path: generation.local_path,
          thumbnail_path: generation.thumbnail_path,
          preview_gif_path: generation.preview_gif_path,
          error_message: generation.error_message,
          prompt: generation.prompt,
          resolution: generation.resolution,
          duration: generation.duration,
          credits_consumed: generation.credits_consumed,
          created_at: generation.created_at,
          updated_at: generation.updated_at,
          completed_at: generation.completed_at
        });
      }

      if (generation.status === 'submitted' || generation.status === 'queued' || generation.status === 'running') {
        try {
          const model = await VideoModel.findById(generation.model_id);
          if (model) {
            const taskData = await VideoService.queryTaskStatus(task_id, model);

            if (taskData.status === 'succeeded' && !generation.local_path) {
              logger.info('API返回成功但数据库未更新，返回处理中状态', {
                taskId: task_id
              });

              return ResponseHelper.success(res, {
                id: generation.id,
                task_id: generation.task_id,
                status: 'running',
                progress: 95,
                video_url: null,
                local_path: null,
                thumbnail_path: null,
                prompt: generation.prompt,
                resolution: generation.resolution,
                duration: generation.duration,
                created_at: generation.created_at,
                updated_at: generation.updated_at
              });
            }

            return ResponseHelper.success(res, {
              id: generation.id,
              task_id: generation.task_id,
              status: taskData.status || generation.status,
              progress: taskData.progress ? parseInt(taskData.progress * 100) : generation.progress,
              video_url: taskData.video_url || generation.video_url,
              local_path: generation.local_path,
              thumbnail_path: generation.thumbnail_path,
              prompt: generation.prompt,
              resolution: generation.resolution,
              duration: generation.duration,
              created_at: generation.created_at,
              updated_at: generation.updated_at
            });
          }
        } catch (error) {
          logger.warn('查询视频任务状态失败，返回数据库状态', { task_id, error: error.message });
        }
      }

      return ResponseHelper.success(res, generation);
    } catch (error) {
      logger.error('获取任务状态失败:', error);
      return ResponseHelper.error(res, '获取任务状态失败');
    }
  }

  /**
   * 获取用户的生成历史
   *
   * v1.1 新增 keyword 参数透传
   */
  static async getUserHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status, is_favorite, model_id, keyword } = req.query;

      const result = await VideoGeneration.getUserHistory(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        is_favorite: is_favorite === 'true' ? 1 : is_favorite === 'false' ? 0 : null,
        model_id: model_id ? parseInt(model_id) : null,
        keyword: keyword || null
      });

      return ResponseHelper.success(res, result);
    } catch (error) {
      logger.error('获取生成历史失败:', error);
      return ResponseHelper.error(res, '获取历史记录失败');
    }
  }

  static async getGeneration(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const generation = await VideoGeneration.findById(id);

      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }

      if (generation.user_id !== userId && !generation.is_public) {
        return ResponseHelper.forbidden(res, '无权查看此记录');
      }

      if (generation.is_public && generation.user_id !== userId) {
        await VideoGeneration.incrementViewCount(id);
      }

      return ResponseHelper.success(res, generation);
    } catch (error) {
      logger.error('获取生成记录失败:', error);
      return ResponseHelper.error(res, '获取记录失败');
    }
  }

  static async deleteGeneration(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const generation = await VideoGeneration.findById(id);
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }

      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权删除此记录');
      }

      await VideoService.deleteVideoFile(
        generation.local_path,
        generation.thumbnail_path,
        generation.preview_gif_path
      );

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

  static async batchDeleteGenerations(req, res) {
    try {
      const { ids } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(ids) || ids.length === 0) {
        return ResponseHelper.validation(res, { ids: '请选择要删除的记录' });
      }

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

      const deletedCount = await VideoGeneration.batchDelete(ids, userId);

      return ResponseHelper.success(res, { deletedCount }, `成功删除 ${deletedCount} 条记录`);
    } catch (error) {
      logger.error('批量删除失败:', error);
      return ResponseHelper.error(res, '批量删除失败');
    }
  }

  static async toggleFavorite(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const success = await VideoGeneration.toggleFavorite(id, userId);

      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }

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
   *
   * v1.1 新增 keyword 参数透传
   */
  static async getPublicGallery(req, res) {
    try {
      const { page = 1, limit = 20, model_id, keyword } = req.query;

      const result = await VideoGeneration.getPublicGallery({
        page: parseInt(page),
        limit: parseInt(limit),
        model_id: model_id ? parseInt(model_id) : null,
        keyword: keyword || null
      });

      return ResponseHelper.success(res, result);
    } catch (error) {
      logger.error('获取公开画廊失败:', error);
      return ResponseHelper.error(res, '获取画廊失败');
    }
  }

  static async togglePublic(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const generation = await VideoGeneration.findById(id);
      if (!generation) {
        return ResponseHelper.notFound(res, '记录不存在');
      }

      if (generation.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权操作此记录');
      }

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

class VideoAdminController {
  static async getAllModels(req, res) {
    try {
      const models = await VideoModel.findAll();
      return ResponseHelper.success(res, models);
    } catch (error) {
      logger.error('获取视频模型列表失败:', error);
      return ResponseHelper.error(res, '获取模型列表失败');
    }
  }

  static async createModel(req, res) {
    try {
      const modelData = req.body;

      if (modelData.provider === 'kling') {
        if (!modelData.name || !modelData.display_name || !modelData.endpoint) {
          return ResponseHelper.validation(res, {
            name: !modelData.name ? '模型标识不能为空' : null,
            display_name: !modelData.display_name ? '显示名称不能为空' : null,
            endpoint: !modelData.endpoint ? 'API端点不能为空' : null
          });
        }

        if (!modelData.api_config || !modelData.api_config.access_key || !modelData.api_config.secret_key) {
          return ResponseHelper.validation(res, {
            api_config: 'Access Key和Secret Key不能为空'
          });
        }

        modelData.model_id = null;

      } else if (modelData.provider === 'sora2_goapi') {
        if (!modelData.name || !modelData.display_name || !modelData.endpoint || !modelData.api_key) {
          return ResponseHelper.validation(res, {
            name: !modelData.name ? '模型标识不能为空' : null,
            display_name: !modelData.display_name ? '显示名称不能为空' : null,
            endpoint: !modelData.endpoint ? 'API端点不能为空' : null,
            api_key: !modelData.api_key ? 'API密钥不能为空' : null
          });
        }

        modelData.model_id = null;

        if (!modelData.api_config) {
          modelData.api_config = {};
        }
        modelData.api_config = {
          ...modelData.api_config,
          base_url: modelData.endpoint || 'https://goapi.gptnb.ai',
          create_endpoint: '/sora2/v1/create',
          query_endpoint: '/sora2/v1/query'
        };

      } else {
        if (!modelData.name || !modelData.display_name || !modelData.endpoint || !modelData.model_id) {
          return ResponseHelper.validation(res, {
            name: !modelData.name ? '模型标识不能为空' : null,
            display_name: !modelData.display_name ? '显示名称不能为空' : null,
            endpoint: !modelData.endpoint ? 'API端点不能为空' : null,
            model_id: !modelData.model_id ? '模型ID不能为空' : null
          });
        }
      }

      const modelId = await VideoModel.create(modelData);
      const newModel = await VideoModel.findById(modelId);

      const safeModel = { ...newModel };
      delete safeModel.api_key;

      if (newModel.provider === 'kling') {
        safeModel.has_api_key = !!(newModel.api_config &&
          newModel.api_config.access_key &&
          newModel.api_config.secret_key);
      } else {
        safeModel.has_api_key = !!newModel.api_key;
      }

      return ResponseHelper.success(res, safeModel, '模型创建成功');
    } catch (error) {
      logger.error('创建视频模型失败:', error);
      return ResponseHelper.error(res, error.message || '创建模型失败');
    }
  }

  static async updateModel(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const existingModel = await VideoModel.findById(id);
      if (!existingModel) {
        return ResponseHelper.notFound(res, '模型不存在');
      }

      if (existingModel.provider === 'kling' && updateData.api_config) {
        const existingConfig = existingModel.api_config || {};
        updateData.api_config = { ...existingConfig, ...updateData.api_config };
      }

      if (existingModel.provider === 'sora2_goapi' && updateData.api_config) {
        const existingConfig = existingModel.api_config || {};
        updateData.api_config = {
          ...existingConfig,
          ...updateData.api_config,
          base_url: updateData.endpoint || existingConfig.base_url || 'https://goapi.gptnb.ai',
          create_endpoint: '/sora2/v1/create',
          query_endpoint: '/sora2/v1/query'
        };
      }

      const success = await VideoModel.update(id, updateData);

      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }

      const updatedModel = await VideoModel.findById(id);

      const safeModel = { ...updatedModel };
      delete safeModel.api_key;

      if (updatedModel.provider === 'kling') {
        safeModel.has_api_key = !!(updatedModel.api_config &&
          updatedModel.api_config.access_key &&
          updatedModel.api_config.secret_key);
      } else {
        safeModel.has_api_key = !!updatedModel.api_key;
      }

      return ResponseHelper.success(res, safeModel, '模型更新成功');
    } catch (error) {
      logger.error('更新视频模型失败:', error);
      return ResponseHelper.error(res, '更新模型失败');
    }
  }

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
