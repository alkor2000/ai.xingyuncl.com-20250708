/**
 * 视频生成服务
 * 处理与火山方舟视频API的交互
 */

const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const VideoModel = require('../models/VideoModel');
const VideoGeneration = require('../models/VideoGeneration');
const User = require('../models/User');
const ossService = require('./ossService');
const logger = require('../utils/logger');

class VideoService {
  /**
   * 提交视频生成任务
   * @param {number} userId - 用户ID
   * @param {number} modelId - 模型ID
   * @param {object} params - 生成参数
   * @returns {object} 任务信息
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

      // 4. 创建生成记录
      generationId = await VideoGeneration.create({
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
        credits_consumed: creditsRequired
      });

      // 5. 构建API请求
      const apiKey = VideoModel.decryptApiKey(model.api_key);
      if (!apiKey) {
        throw new Error('API密钥未配置');
      }

      // 构建请求内容
      const content = [];
      
      // 添加文本内容
      const textContent = this.buildTextContent(params, model);
      content.push({
        type: 'text',
        text: textContent
      });

      // 如果有首帧图片，添加图片内容
      if (params.first_frame_image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: params.first_frame_image
          },
          role: 'first_frame'
        });
      }

      // 如果有尾帧图片，添加图片内容
      if (params.last_frame_image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: params.last_frame_image
          },
          role: 'last_frame'
        });
      }

      const requestData = {
        model: model.model_id,
        content,
        return_last_frame: params.return_last_frame || false,
        callback_url: params.callback_url || model.api_config?.webhook_url
      };

      logger.info('提交视频生成任务', {
        userId,
        modelId,
        generationId,
        creditsRequired
      });

      // 6. 调用火山方舟API
      const response = await axios.post(
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

      // 7. 处理响应
      if (!response.data || !response.data.id) {
        throw new Error('API返回数据格式错误');
      }

      const taskId = response.data.id;

      // 8. 更新生成记录
      await VideoGeneration.update(generationId, {
        task_id: taskId,
        status: 'queued'
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
      this.pollTaskStatus(taskId, generationId, model, userId);

      return {
        success: true,
        generationId,
        taskId,
        creditsConsumed: creditsRequired,
        message: '视频生成任务已提交，请稍候...'
      };

    } catch (error) {
      logger.error('提交视频生成任务失败', {
        userId,
        modelId,
        generationId,
        error: error.message
      });

      // 更新失败状态
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
   * 构建文本内容（包含参数）
   */
  static buildTextContent(params, model) {
    let text = params.prompt;
    const commandParams = [];

    // 添加分辨率参数
    if (params.resolution && params.resolution !== model.default_resolution) {
      commandParams.push(`--rs ${params.resolution}`);
    }

    // 添加宽高比参数
    if (params.ratio && params.ratio !== model.default_ratio) {
      commandParams.push(`--rt ${params.ratio}`);
    }

    // 添加时长参数
    if (params.duration && params.duration !== model.default_duration) {
      commandParams.push(`--dur ${params.duration}`);
    }

    // 添加帧率参数
    if (params.fps && params.fps !== model.default_fps) {
      commandParams.push(`--fps ${params.fps}`);
    }

    // 添加水印参数
    if (params.watermark === false) {
      commandParams.push('--wm false');
    }

    // 添加固定摄像头参数
    if (params.camera_fixed) {
      commandParams.push('--cf true');
    }

    // 添加种子参数
    if (params.seed && params.seed !== -1) {
      commandParams.push(`--seed ${params.seed}`);
    }

    // 组合文本和参数
    if (commandParams.length > 0) {
      text = `${text} ${commandParams.join(' ')}`;
    }

    return text;
  }

  /**
   * 查询任务状态
   */
  static async queryTaskStatus(taskId, model) {
    try {
      const apiKey = VideoModel.decryptApiKey(model.api_key);
      
      // 构建查询URL
      const queryUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`;
      
      const response = await axios.get(queryUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      logger.error('查询视频任务状态失败', {
        taskId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 轮询任务状态
   */
  static async pollTaskStatus(taskId, generationId, model, userId) {
    const pollingInterval = 10000; // 10秒
    const maxPollingTime = 600000; // 10分钟
    const startTime = Date.now();

    const poll = async () => {
      try {
        // 检查是否超时
        if (Date.now() - startTime > maxPollingTime) {
          await VideoGeneration.update(generationId, {
            status: 'failed',
            error_message: '任务超时',
            generation_time: Math.floor((Date.now() - startTime) / 1000)
          });
          return;
        }

        // 查询任务状态
        const taskData = await this.queryTaskStatus(taskId, model);
        
        logger.info('查询到任务状态', {
          taskId,
          status: taskData.status,
          hasContent: !!taskData.content,
          hasVideoUrl: !!(taskData.content && taskData.content.video_url)
        });

        // 更新进度
        if (taskData.progress !== undefined) {
          await VideoGeneration.update(generationId, {
            progress: parseInt(taskData.progress * 100)
          });
        }

        // 根据状态处理
        if (taskData.status === 'succeeded') {
          // 获取视频URL - 注意这里是从content字段获取
          const videoUrl = taskData.content?.video_url;
          
          if (!videoUrl) {
            throw new Error('API返回成功但没有视频URL');
          }

          // 下载并保存视频
          const saveResult = await this.downloadAndSaveVideo(
            videoUrl,
            generationId,
            userId
          );

          // 更新生成记录
          await VideoGeneration.update(generationId, {
            status: 'succeeded',
            video_url: videoUrl,
            local_path: saveResult.localPath,
            thumbnail_path: saveResult.thumbnailPath,
            preview_gif_path: saveResult.previewGifPath,
            last_frame_path: taskData.content?.last_frame_url || null,
            file_size: saveResult.fileSize,
            video_width: saveResult.width,
            video_height: saveResult.height,
            video_duration: taskData.duration || saveResult.duration,
            generation_time: Math.floor((Date.now() - startTime) / 1000),
            completed_at: new Date()
          });

          logger.info('视频生成任务完成', {
            taskId,
            generationId,
            userId,
            time: Date.now() - startTime
          });

        } else if (taskData.status === 'failed') {
          // 任务失败
          await VideoGeneration.update(generationId, {
            status: 'failed',
            error_message: taskData.error || '生成失败',
            generation_time: Math.floor((Date.now() - startTime) / 1000)
          });

          logger.error('视频生成任务失败', {
            taskId,
            generationId,
            error: taskData.error
          });

        } else if (taskData.status === 'running') {
          // 更新为运行中状态
          await VideoGeneration.update(generationId, {
            status: 'running'
          });
          
          // 继续轮询
          setTimeout(poll, pollingInterval);
          
        } else {
          // 其他状态（queued等），继续轮询
          setTimeout(poll, pollingInterval);
        }
      } catch (error) {
        logger.error('轮询视频任务状态出错', {
          taskId,
          generationId,
          error: error.message
        });
        
        // 如果是关键错误，标记为失败
        if (error.message.includes('没有视频URL')) {
          await VideoGeneration.update(generationId, {
            status: 'failed',
            error_message: error.message,
            generation_time: Math.floor((Date.now() - startTime) / 1000)
          });
        } else {
          // 其他错误重试
          setTimeout(poll, pollingInterval * 2);
        }
      }
    };

    // 开始轮询
    setTimeout(poll, pollingInterval);
  }

  /**
   * 下载并保存视频
   */
  static async downloadAndSaveVideo(videoUrl, generationId, userId) {
    try {
      if (!videoUrl) {
        throw new Error('视频URL为空');
      }

      logger.info('开始下载视频', {
        videoUrl: videoUrl.substring(0, 100) + '...',
        generationId,
        userId
      });

      // 下载视频
      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120000, // 2分钟超时
        maxContentLength: 500 * 1024 * 1024, // 最大500MB
        maxBodyLength: 500 * 1024 * 1024
      });

      const videoBuffer = Buffer.from(response.data);
      
      // 初始化OSS服务
      await ossService.initialize();
      
      // 生成文件名和路径
      const dateFolder = new Date().toISOString().slice(0, 7); // YYYY-MM
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const fileName = `video_${generationId}_${timestamp}_${random}.mp4`;
      const thumbFileName = `thumb_${generationId}_${timestamp}_${random}.jpg`;
      
      // 构建OSS key
      const ossKey = `videos/${userId}/${dateFolder}/${fileName}`;
      const thumbOssKey = `videos/${userId}/${dateFolder}/${thumbFileName}`;
      
      // 上传视频到OSS
      const uploadResult = await ossService.uploadFile(videoBuffer, ossKey, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `inline; filename="${fileName}"`
        }
      });
      
      // TODO: 生成缩略图（需要ffmpeg支持）
      // 暂时使用视频URL作为缩略图
      const thumbnailUrl = uploadResult.url;
      
      logger.info('视频已保存', {
        generationId,
        userId,
        ossKey,
        isLocal: uploadResult.isLocal,
        url: uploadResult.url
      });
      
      return {
        localPath: uploadResult.url,
        thumbnailPath: thumbnailUrl,
        previewGifPath: null, // TODO: 生成预览GIF
        fileSize: videoBuffer.length,
        width: 1920, // TODO: 从视频元数据获取
        height: 1080,
        duration: null // TODO: 从视频元数据获取
      };
      
    } catch (error) {
      logger.error('下载保存视频失败', {
        generationId,
        userId,
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
      
      // 删除视频文件
      const videoKey = extractOssKey(localPath);
      if (videoKey) {
        await ossService.deleteFile(videoKey);
      }
      
      // 删除缩略图
      const thumbKey = extractOssKey(thumbnailPath);
      if (thumbKey) {
        await ossService.deleteFile(thumbKey);
      }
      
      // 删除预览GIF
      const gifKey = extractOssKey(previewGifPath);
      if (gifKey) {
        await ossService.deleteFile(gifKey);
      }
      
    } catch (error) {
      logger.error('删除视频文件失败', { 
        localPath,
        thumbnailPath,
        previewGifPath,
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
    
    // 验证提示词
    if (!params.prompt || params.prompt.trim().length === 0) {
      errors.push('提示词不能为空');
    } else if (params.prompt.length > (model?.max_prompt_length || 500)) {
      errors.push(`提示词长度不能超过${model?.max_prompt_length || 500}字符`);
    }
    
    // 验证分辨率
    if (params.resolution && model?.resolutions_supported) {
      if (!model.resolutions_supported.includes(params.resolution)) {
        errors.push('不支持的分辨率');
      }
    }
    
    // 验证时长
    if (params.duration && model?.durations_supported) {
      if (!model.durations_supported.includes(params.duration)) {
        errors.push('不支持的时长');
      }
    }
    
    // 验证帧率
    if (params.fps && model?.fps_supported) {
      if (!model.fps_supported.includes(params.fps)) {
        errors.push('不支持的帧率');
      }
    }
    
    // 验证宽高比
    if (params.ratio && model?.ratios_supported) {
      if (!model.ratios_supported.includes(params.ratio)) {
        errors.push('不支持的宽高比');
      }
    }
    
    return errors;
  }
}

module.exports = VideoService;
