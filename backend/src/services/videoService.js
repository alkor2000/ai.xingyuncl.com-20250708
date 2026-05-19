/**
 * 视频生成服务
 * 处理与火山方舟、可灵和Sora2视频API的交互
 *
 * v1.2 改动:
 * - submitToVolcano 增加 try/catch 提取上游响应体 response.data 写入日志
 * - 上游400/422错误时把火山返回的具体 message 抛出（替代 axios 默认的 "Request failed with status code 400"）
 */

const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const VideoModel = require('../models/VideoModel');
const VideoGeneration = require('../models/VideoGeneration');
const User = require('../models/User');
const ossService = require('./ossService');
const klingVideoService = require('./klingVideoService');
const sora2VideoService = require('./sora2VideoService');
const logger = require('../utils/logger');

/**
 * 从上游 API 错误响应中提取人类可读的错误信息
 * 支持 OpenAI/火山/通用三种格式
 * @param {Error} error - axios 错误对象
 * @param {string} provider - 提供商标识用于日志
 * @returns {string} 提取后的错误描述
 */
function extractUpstreamError(error, provider = 'upstream') {
  /* 网络层错误（无 response）直接返回 */
  if (!error.response) {
    return error.message || `${provider} 网络错误`;
  }

  const status = error.response.status;
  const data = error.response.data;

  /* 详细日志：记录完整的上游响应体供排查 */
  logger.error(`上游API错误响应详情 [${provider}]`, {
    status,
    statusText: error.response.statusText,
    upstream_data: data,        // ← 关键：火山返回的具体错误体
    requestUrl: error.config?.url,
    requestMethod: error.config?.method
  });

  /* 尝试从常见字段提取 message */
  let message = '';
  if (typeof data === 'string') {
    message = data;
  } else if (data && typeof data === 'object') {
    /* 火山格式: {"error": {"code": "xxx", "message": "yyy"}} 或 {"code": "xxx", "message": "yyy"} */
    message = data.error?.message
           || data.message
           || data.error_msg
           || data.msg
           || JSON.stringify(data);
  }

  return message
    ? `${provider}: ${message}`
    : `${provider}: HTTP ${status} ${error.response.statusText || ''}`;
}

class VideoService {
  /**
   * 提交视频生成任务
   */
  static async submitVideoGeneration(userId, modelId, params) {
    const startTime = Date.now();
    let generationId = null;

    try {
      // 1. 获取模型配置
      const model = await VideoModel.findById(modelId);
      if (!model || !model.is_active) {
        throw new Error('模型不存在或未启用');
      }

      // 2. 获取用户信息并检查积分
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('用户不存在');
      }

      // 3. 计算积分消耗
      const creditsRequired = VideoModel.calculatePrice(
        model,
        params.resolution || model.default_resolution,
        params.duration || model.default_duration
      );

      if (!user.hasCredits(creditsRequired)) {
        throw new Error(`积分不足，需要 ${creditsRequired} 积分`);
      }

      // 4. 准备生成记录数据
      const generationData = {
        user_id: userId,
        model_id: modelId,
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        first_frame_image: params.first_frame_image,
        last_frame_image: params.last_frame_image,
        generation_mode: params.generation_mode || 'text_to_video',
        resolution: params.resolution || model.default_resolution,
        duration: params.duration || model.default_duration,
        fps: params.fps || model.default_fps,
        ratio: params.ratio || model.default_ratio,
        seed: params.seed || -1,
        watermark: params.watermark !== false,
        camera_fixed: params.camera_fixed || false,
        status: 'submitted',
        credits_consumed: creditsRequired,
        provider: model.provider,
        started_at: new Date()
      };

      // 5. Sora2 的 orientation 和 reference_images
      if (model.provider === 'sora2_goapi') {
        generationData.orientation = sora2VideoService.convertRatioToOrientation(
          params.ratio || model.default_ratio
        );

        if (params.first_frame_image || params.last_frame_image) {
          const images = [];
          if (params.first_frame_image) images.push(params.first_frame_image);
          if (params.last_frame_image) images.push(params.last_frame_image);
          generationData.reference_images = JSON.stringify(images);
        }
      }

      // 6. 创建生成记录
      generationId = await VideoGeneration.create(generationData);

      // 7. 根据 provider 调用不同 API
      let taskResult;

      if (model.provider === 'kling') {
        logger.info('使用可灵API生成视频', {
          userId, modelId, generationId,
          model_version: model.api_config?.model_version
        });

        if (params.generation_mode === 'first_frame' || params.generation_mode === 'image_to_video') {
          taskResult = await klingVideoService.submitImage2Video(model, params);
        } else {
          taskResult = await klingVideoService.submitText2Video(model, params);
        }
      } else if (model.provider === 'sora2_goapi') {
        logger.info('使用Sora2 API生成视频', {
          userId, modelId, generationId,
          orientation: generationData.orientation
        });

        if (params.generation_mode === 'first_frame' ||
            params.generation_mode === 'image_to_video' ||
            params.first_frame_image) {
          taskResult = await sora2VideoService.submitImage2Video(model, params);
        } else {
          taskResult = await sora2VideoService.submitText2Video(model, params);
        }

        if (taskResult.rawResponse && taskResult.rawResponse.detail) {
          const genId = taskResult.rawResponse.detail.draft_info?.generation_id;
          if (genId) {
            await VideoGeneration.update(generationId, {
              generation_id: genId,
              raw_response: JSON.stringify(taskResult.rawResponse)
            });
          }
        }
      } else {
        logger.info('使用火山方舟API生成视频', {
          userId, modelId, generationId,
          generation_mode: params.generation_mode,
          has_first_frame: !!params.first_frame_image,
          has_last_frame: !!params.last_frame_image
        });

        taskResult = await this.submitToVolcano(model, params);
      }

      // 8. 更新生成记录
      await VideoGeneration.update(generationId, {
        task_id: taskResult.taskId,
        status: taskResult.status || 'queued'
      });

      // 9. 扣除积分
      await user.consumeCredits(
        creditsRequired,
        null,
        null,
        `视频生成 - ${model.display_name}`,
        'video_consume'
      );

      // 10. 开始轮询任务状态
      this.pollTaskStatus(taskResult.taskId, generationId, model, userId);

      return {
        success: true,
        generationId,
        taskId: taskResult.taskId,
        creditsConsumed: creditsRequired,
        message: '视频生成任务已提交，请稍候...'
      };

    } catch (error) {
      logger.error('提交视频生成任务失败', {
        userId, modelId, generationId,
        error: error.message
      });

      if (generationId) {
        await VideoGeneration.update(generationId, {
          status: 'failed',
          error_message: error.message,
          generation_time: Math.floor((Date.now() - startTime) / 1000)
        });
      }

      throw error;
    }
  }

  /**
   * 提交到火山方舟
   * v1.2: 增加上游错误响应提取，把 400 的具体原因暴露出来
   */
  static async submitToVolcano(model, params) {
    const apiKey = VideoModel.decryptApiKey(model.api_key);
    if (!apiKey) {
      throw new Error('API密钥未配置');
    }

    /* 构建请求内容 */
    const content = [];

    const textContent = this.buildTextContent(params, model);
    content.push({
      type: 'text',
      text: textContent
    });

    if (params.first_frame_image) {
      content.push({
        type: 'image_url',
        image_url: { url: params.first_frame_image },
        role: 'first_frame'
      });
    }

    if (params.last_frame_image) {
      content.push({
        type: 'image_url',
        image_url: { url: params.last_frame_image },
        role: 'last_frame'
      });
    }

    const requestData = {
      model: model.model_id,
      content,
      return_last_frame: params.return_last_frame || false,
      callback_url: params.callback_url || model.api_config?.webhook_url
    };

    /* 详细日志：记录将要发送给火山的请求内容（脱敏） */
    logger.info('调用火山方舟API', {
      modelId: model.id,
      modelName: model.model_id,
      contentBlocks: content.map(c => ({
        type: c.type,
        role: c.role,
        hasUrl: !!c.image_url,
        textPreview: c.text ? c.text.substring(0, 80) : null
      })),
      return_last_frame: requestData.return_last_frame,
      has_callback: !!requestData.callback_url
    });

    /* v1.2 关键: try/catch 包装 axios 调用，提取上游错误 */
    let response;
    try {
      response = await axios.post(
        model.endpoint,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 30000
        }
      );
    } catch (axiosError) {
      /* 提取上游真实错误信息并抛出 */
      const detailedMessage = extractUpstreamError(axiosError, '火山方舟');
      throw new Error(detailedMessage);
    }

    /* 处理响应 */
    if (!response.data || !response.data.id) {
      logger.error('火山API响应格式异常', { response_data: response.data });
      throw new Error('火山方舟API返回数据格式错误（缺少 task id）');
    }

    return {
      taskId: response.data.id,
      status: 'submitted'
    };
  }

  /**
   * 构建文本内容
   */
  static buildTextContent(params, model) {
    let text = params.prompt;
    const commandParams = [];

    if (params.resolution && params.resolution !== model.default_resolution) {
      commandParams.push(`--rs ${params.resolution}`);
    }
    if (params.ratio && params.ratio !== model.default_ratio) {
      commandParams.push(`--rt ${params.ratio}`);
    }
    if (params.duration && params.duration !== model.default_duration) {
      commandParams.push(`--dur ${params.duration}`);
    }
    if (params.fps && params.fps !== model.default_fps) {
      commandParams.push(`--fps ${params.fps}`);
    }
    if (params.watermark === false) {
      commandParams.push('--wm false');
    }
    if (params.camera_fixed) {
      commandParams.push('--cf true');
    }
    if (params.seed && params.seed !== -1) {
      commandParams.push(`--seed ${params.seed}`);
    }

    if (commandParams.length > 0) {
      text = `${text} ${commandParams.join(' ')}`;
    }

    return text;
  }

  /**
   * 查询任务状态
   * v1.2: 火山查询也加上错误提取
   */
  static async queryTaskStatus(taskId, model) {
    try {
      if (model.provider === 'kling') {
        return await klingVideoService.queryTaskStatus(taskId, model);
      } else if (model.provider === 'sora2_goapi') {
        return await sora2VideoService.queryTaskStatus(taskId, model);
      } else {
        const apiKey = VideoModel.decryptApiKey(model.api_key);
        const queryUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`;

        let response;
        try {
          response = await axios.get(queryUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000
          });
        } catch (axiosError) {
          const detailedMessage = extractUpstreamError(axiosError, '火山方舟查询');
          throw new Error(detailedMessage);
        }

        const taskData = response.data;

        return {
          status: taskData.status,
          progress: taskData.progress,
          video_url: taskData.content?.video_url,
          error: taskData.error
        };
      }
    } catch (error) {
      logger.error('查询视频任务状态失败', {
        taskId,
        provider: model.provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 轮询任务状态
   */
  static async pollTaskStatus(taskId, generationId, model, userId) {
    const pollingInterval = 10000;
    const maxPollingTime = 600000;
    const startTime = Date.now();

    const poll = async () => {
      try {
        if (Date.now() - startTime > maxPollingTime) {
          await VideoGeneration.update(generationId, {
            status: 'failed',
            error_message: '任务超时',
            generation_time: Math.floor((Date.now() - startTime) / 1000)
          });
          return;
        }

        const taskData = await this.queryTaskStatus(taskId, model);

        logger.info('查询到任务状态', {
          taskId,
          status: taskData.status,
          provider: model.provider,
          hasVideoUrl: !!taskData.videoUrl || !!taskData.video_url
        });

        if (taskData.progress !== undefined) {
          await VideoGeneration.update(generationId, {
            progress: parseInt(taskData.progress * 100)
          });
        }

        if (taskData.status === 'succeeded') {
          const videoUrl = taskData.videoUrl || taskData.video_url;

          if (!videoUrl) {
            throw new Error('API返回成功但没有视频URL');
          }

          let saveResult;
          if (model.provider === 'kling') {
            saveResult = await klingVideoService.downloadAndSaveVideo(
              videoUrl, userId, generationId
            );
          } else if (model.provider === 'sora2_goapi') {
            saveResult = await sora2VideoService.downloadAndSaveVideo(
              videoUrl, taskData.thumbnailUrl, taskData.gifUrl, userId, generationId
            );
          } else {
            saveResult = await this.downloadAndSaveVideo(
              videoUrl, generationId, userId
            );
          }

          await VideoGeneration.update(generationId, {
            status: 'succeeded',
            video_url: videoUrl,
            local_path: saveResult.localPath,
            thumbnail_path: saveResult.thumbnailPath,
            preview_gif_path: saveResult.previewGifPath,
            last_frame_path: taskData.last_frame_url || null,
            file_size: saveResult.fileSize,
            video_width: saveResult.width || taskData.width,
            video_height: saveResult.height || taskData.height,
            video_duration: taskData.duration || saveResult.duration,
            generation_time: Math.floor((Date.now() - startTime) / 1000),
            completed_at: new Date()
          });

          logger.info('视频生成任务完成', {
            taskId, generationId, userId,
            provider: model.provider,
            time: Date.now() - startTime
          });

        } else if (taskData.status === 'failed') {
          await VideoGeneration.update(generationId, {
            status: 'failed',
            error_message: taskData.errorMessage || taskData.error || '生成失败',
            generation_time: Math.floor((Date.now() - startTime) / 1000)
          });

          logger.error('视频生成任务失败', {
            taskId, generationId,
            provider: model.provider,
            error: taskData.errorMessage || taskData.error
          });

        } else if (taskData.status === 'running') {
          await VideoGeneration.update(generationId, { status: 'running' });
          setTimeout(poll, pollingInterval);

        } else {
          setTimeout(poll, pollingInterval);
        }
      } catch (error) {
        logger.error('轮询视频任务状态出错', {
          taskId, generationId,
          provider: model.provider,
          error: error.message
        });

        if (error.message.includes('没有视频URL')) {
          await VideoGeneration.update(generationId, {
            status: 'failed',
            error_message: error.message,
            generation_time: Math.floor((Date.now() - startTime) / 1000)
          });
        } else {
          setTimeout(poll, pollingInterval * 2);
        }
      }
    };

    setTimeout(poll, pollingInterval);
  }

  /**
   * 下载并保存视频（火山）
   */
  static async downloadAndSaveVideo(videoUrl, generationId, userId) {
    try {
      if (!videoUrl) {
        throw new Error('视频URL为空');
      }

      logger.info('开始下载视频', {
        videoUrl: videoUrl.substring(0, 100) + '...',
        generationId, userId
      });

      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: 500 * 1024 * 1024
      });

      const videoBuffer = Buffer.from(response.data);

      await ossService.initialize();

      const dateFolder = new Date().toISOString().slice(0, 7);
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const fileName = `video_${generationId}_${timestamp}_${random}.mp4`;
      const thumbFileName = `thumb_${generationId}_${timestamp}_${random}.jpg`;

      const ossKey = `videos/${userId}/${dateFolder}/${fileName}`;
      const thumbOssKey = `videos/${userId}/${dateFolder}/${thumbFileName}`;

      const uploadResult = await ossService.uploadFile(videoBuffer, ossKey, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `inline; filename="${fileName}"`
        }
      });

      const thumbnailUrl = uploadResult.url;

      logger.info('视频已保存', {
        generationId, userId, ossKey,
        isLocal: uploadResult.isLocal,
        url: uploadResult.url
      });

      return {
        localPath: uploadResult.url,
        thumbnailPath: thumbnailUrl,
        previewGifPath: null,
        fileSize: videoBuffer.length,
        width: 1920,
        height: 1080,
        duration: null
      };

    } catch (error) {
      logger.error('下载保存视频失败', {
        generationId, userId,
        error: error.message
      });
      throw new Error('保存视频失败: ' + error.message);
    }
  }

  /**
   * 删除视频文件
   */
  static async deleteVideoFile(localPath, thumbnailPath, previewGifPath) {
    try {
      await ossService.initialize();

      const extractOssKey = (url) => {
        if (!url) return null;
        if (url.startsWith('/storage/uploads/')) {
          return url.replace('/storage/uploads/', '');
        }
        if (url.includes('/storage/uploads/')) {
          const match = url.match(/\/storage\/uploads\/(.+)/);
          return match ? match[1] : null;
        }
        if (url.startsWith('http://') || url.startsWith('https://')) {
          try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            return pathname.startsWith('/') ? pathname.slice(1) : pathname;
          } catch (e) {
            return null;
          }
        }
        return url;
      };

      const videoKey = extractOssKey(localPath);
      if (videoKey) await ossService.deleteFile(videoKey);

      const thumbKey = extractOssKey(thumbnailPath);
      if (thumbKey) await ossService.deleteFile(thumbKey);

      const gifKey = extractOssKey(previewGifPath);
      if (gifKey) await ossService.deleteFile(gifKey);

    } catch (error) {
      logger.error('删除视频文件失败', {
        localPath, thumbnailPath, previewGifPath,
        error: error.message
      });
    }
  }

  /**
   * 获取可用的视频模型列表
   */
  static async getAvailableModels() {
    try {
      return await VideoModel.findAll(true);
    } catch (error) {
      logger.error('获取可用视频模型失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 验证生成参数
   */
  static validateGenerationParams(params, model) {
    const errors = [];

    if (!params.prompt || params.prompt.trim().length === 0) {
      errors.push('提示词不能为空');
    } else if (params.prompt.length > (model?.max_prompt_length || 500)) {
      errors.push(`提示词长度不能超过${model?.max_prompt_length || 500}字符`);
    }

    if (params.resolution && model?.resolutions_supported) {
      if (!model.resolutions_supported.includes(params.resolution)) {
        errors.push('不支持的分辨率');
      }
    }

    if (params.duration && model?.durations_supported) {
      if (!model.durations_supported.includes(params.duration)) {
        errors.push('不支持的时长');
      }
    }

    if (params.fps && model?.fps_supported) {
      if (!model.fps_supported.includes(params.fps)) {
        errors.push('不支持的帧率');
      }
    }

    if (params.ratio && model?.ratios_supported) {
      if (!model.ratios_supported.includes(params.ratio)) {
        errors.push('不支持的宽高比');
      }
    }

    return errors;
  }
}

module.exports = VideoService;
