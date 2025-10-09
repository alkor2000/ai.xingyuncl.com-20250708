/**
 * Sora 2 视频生成服务 (GoAPI Provider)
 * 处理与GoAPI Sora2 API的交互
 * 
 * API文档参考:
 * - 创建: POST /sora2/v1/create
 * - 查询: GET /sora2/v1/query?id={task_id}
 * 
 * 支持的模型：
 * - sora-2: 基础版本（支持多种orientation和参数）
 * - sora-2-pro: 专业版本（仅支持landscape，不接受额外参数）
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const ossService = require('./ossService');

class Sora2VideoService {
  constructor() {
    this.defaultBaseUrl = 'https://goapi.gptnb.ai';
  }

  /**
   * 解析模型API配置
   * @param {object} model 模型配置
   * @returns {object} 解析后的配置
   */
  parseModelConfig(model) {
    try {
      // 优先使用api_config,否则使用顶层字段
      let config = {};
      
      if (model.api_config) {
        const apiConfig = typeof model.api_config === 'string' 
          ? JSON.parse(model.api_config) 
          : model.api_config;
        config = apiConfig;
      }
      
      return {
        api_key: model.api_key || config.api_key,
        base_url: model.endpoint || config.base_url || this.defaultBaseUrl,
        create_endpoint: config.create_endpoint || '/sora2/v1/create',
        query_endpoint: config.query_endpoint || '/sora2/v1/query',
        model_name: model.name || 'sora-2',
        auto_download_to_oss: config.auto_download_to_oss !== false,
        download_gif_preview: config.download_gif_preview !== false
      };
    } catch (error) {
      logger.error('解析Sora2模型配置失败:', error);
      throw new Error('模型配置格式错误');
    }
  }

  /**
   * 获取请求头
   * @param {string} apiKey API密钥
   * @returns {object} 请求头
   */
  getHeaders(apiKey) {
    if (!apiKey) {
      throw new Error('Sora2 API密钥未配置');
    }
    
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
  }

  /**
   * 转换方向参数
   * @param {string} ratio 宽高比 (如 "16:9", "9:16", "1:1")
   * @param {string} modelName 模型名称
   * @returns {string} orientation (portrait, landscape, square)
   */
  convertRatioToOrientation(ratio, modelName) {
    // ✅ sora-2-pro 只支持 landscape
    if (modelName === 'sora-2-pro') {
      return 'landscape';
    }
    
    const orientationMap = {
      '16:9': 'landscape',
      '9:16': 'portrait', 
      '1:1': 'square',
      // 其他比例映射
      '4:3': 'landscape',
      '3:4': 'portrait',
      '21:9': 'landscape'
    };
    
    return orientationMap[ratio] || 'landscape';
  }

  /**
   * 翻译OpenAI错误信息为中文
   * @param {string|object} errorData 错误数据（可能是字符串或对象）
   * @param {string} kind 错误类型
   * @returns {string} 中文错误信息
   */
  translateErrorMessage(errorData, kind) {
    let errorMessage = '';
    
    if (!errorData) {
      return '视频生成失败，请稍后重试';
    }
    
    // 如果是对象，提取message字段
    if (typeof errorData === 'object') {
      errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
    } else {
      errorMessage = String(errorData);
    }

    // 常见错误类型映射
    const errorTranslations = {
      'sora_content_violation': '内容审核未通过',
      'content_policy_violation': '违反内容政策',
      'This content may violate our guardrails around nudity, sexuality, or erotic content.': 
        '内容审核未通过：可能涉及裸露、性或色情内容',
      'This content may violate our guardrails concerning similarity to third-party content.': 
        '内容审核未通过：可能涉及受版权保护的第三方内容（如知名IP、品牌等）',
      'This content may violate our guardrails around violence or graphic content.': 
        '内容审核未通过：可能涉及暴力或血腥内容',
      'This content may violate our guardrails around hate speech or discrimination.': 
        '内容审核未通过：可能涉及仇恨言论或歧视内容',
      'This content may violate our guardrails around self-harm.': 
        '内容审核未通过：可能涉及自残内容',
      'This content may violate our guardrails around illegal activity.': 
        '内容审核未通过：可能涉及非法活动',
      'Invalid input': '输入参数无效',
      'Rate limit exceeded': 'API调用频率超限，请稍后重试',
      'Insufficient credits': '账户余额不足',
      'Service unavailable': '服务暂时不可用，请稍后重试',
      'Timeout': '生成超时，请重试',
      'Internal server error': '服务器内部错误，请稍后重试'
    };

    if (errorTranslations[errorMessage]) {
      return errorTranslations[errorMessage];
    }

    if (kind && errorTranslations[kind]) {
      return `${errorTranslations[kind]}：${errorMessage}`;
    }

    const lowerError = errorMessage.toLowerCase();
    
    if (lowerError.includes('invalid') && (lowerError.includes('token') || lowerError.includes('令牌') || lowerError.includes('api key'))) {
      return 'API密钥无效或已过期，请联系管理员更新密钥';
    }
    if (lowerError.includes('unauthorized') || lowerError.includes('401')) {
      return 'API认证失败，请检查密钥是否正确';
    }
    if (lowerError.includes('nudity') || lowerError.includes('sexual') || lowerError.includes('erotic')) {
      return '内容审核未通过：可能涉及不适当内容';
    }
    if (lowerError.includes('copyright') || lowerError.includes('third-party')) {
      return '内容审核未通过：可能涉及版权保护内容';
    }
    if (lowerError.includes('violence') || lowerError.includes('graphic')) {
      return '内容审核未通过：可能涉及暴力内容';
    }
    if (lowerError.includes('rate limit')) {
      return 'API调用频率超限，请稍后重试';
    }

    return `生成失败：${errorMessage}`;
  }

  /**
   * 提交纯文本视频生成任务
   * @param {object} model 模型配置
   * @param {object} params 生成参数
   * @returns {object} 任务信息
   */
  async submitText2Video(model, params) {
    try {
      const config = this.parseModelConfig(model);
      const headers = this.getHeaders(config.api_key);
      
      // ✅ 构建请求参数 - 根据模型类型决定
      const requestData = {
        model: config.model_name,
        orientation: this.convertRatioToOrientation(params.ratio || '16:9', config.model_name),
        prompt: params.prompt
      };
      
      // ✅ sora-2-pro 不接受任何额外参数
      if (config.model_name !== 'sora-2-pro') {
        // 只有 sora-2 才添加这些参数
        // 注意：根据测试，sora-2 也可能不需要这些参数
        // 如果需要，可以取消注释
        // if (params.resolution) requestData.resolution = params.resolution;
        // if (params.duration) requestData.duration = params.duration;
      }
      
      logger.info('提交Sora2纯文本视频任务', {
        model: requestData.model,
        orientation: requestData.orientation,
        promptLength: params.prompt.length,
        isPro: config.model_name === 'sora-2-pro'
      });
      
      const response = await axios.post(
        `${config.base_url}${config.create_endpoint}`,
        requestData,
        { 
          headers, 
          timeout: 30000 
        }
      );
      
      if (!response.data || !response.data.id) {
        throw new Error('Sora2 API返回数据格式错误');
      }
      
      return {
        taskId: response.data.id,
        status: this.convertTaskStatus(response.data.status),
        rawResponse: response.data
      };
    } catch (error) {
      logger.error('提交Sora2纯文本视频任务失败:', {
        error: error.message,
        response: error.response?.data
      });
      
      if (error.response?.data?.error) {
        const translatedError = this.translateErrorMessage(error.response.data.error);
        throw new Error(translatedError);
      }
      
      throw error;
    }
  }

  /**
   * 提交带图片参考的视频生成任务
   * @param {object} model 模型配置
   * @param {object} params 生成参数
   * @returns {object} 任务信息
   */
  async submitImage2Video(model, params) {
    try {
      const config = this.parseModelConfig(model);
      const headers = this.getHeaders(config.api_key);
      
      // ✅ 构建请求参数
      const requestData = {
        model: config.model_name,
        orientation: this.convertRatioToOrientation(params.ratio || '16:9', config.model_name),
        prompt: params.prompt,
        images: []
      };
      
      // 添加首帧图片
      if (params.first_frame_image) {
        requestData.images.push(params.first_frame_image);
      }
      
      // 添加尾帧图片（如果有）
      if (params.last_frame_image) {
        requestData.images.push(params.last_frame_image);
      }
      
      logger.info('提交Sora2图片参考视频任务', {
        model: requestData.model,
        orientation: requestData.orientation,
        imageCount: requestData.images.length,
        promptLength: params.prompt.length,
        isPro: config.model_name === 'sora-2-pro'
      });
      
      const response = await axios.post(
        `${config.base_url}${config.create_endpoint}`,
        requestData,
        { 
          headers, 
          timeout: 30000 
        }
      );
      
      if (!response.data || !response.data.id) {
        throw new Error('Sora2 API返回数据格式错误');
      }
      
      return {
        taskId: response.data.id,
        status: this.convertTaskStatus(response.data.status),
        rawResponse: response.data
      };
    } catch (error) {
      logger.error('提交Sora2图片参考视频任务失败:', {
        error: error.message,
        response: error.response?.data
      });
      
      if (error.response?.data?.error) {
        const translatedError = this.translateErrorMessage(error.response.data.error);
        throw new Error(translatedError);
      }
      
      throw error;
    }
  }

  /**
   * 查询任务状态
   * @param {string} taskId 任务ID
   * @param {object} model 模型配置
   * @returns {object} 任务状态信息
   */
  async queryTaskStatus(taskId, model) {
    try {
      const config = this.parseModelConfig(model);
      const headers = this.getHeaders(config.api_key);
      
      const encodedTaskId = encodeURIComponent(taskId);
      
      const response = await axios.get(
        `${config.base_url}${config.query_endpoint}?id=${encodedTaskId}`,
        { 
          headers, 
          timeout: 10000 
        }
      );
      
      if (!response.data) {
        throw new Error('Sora2 API返回数据为空');
      }
      
      const data = response.data;
      const status = this.convertTaskStatus(data.status);
      
      let videoUrl = null;
      let thumbnailUrl = null;
      let gifUrl = null;
      let width = null;
      let height = null;
      let generationId = null;
      
      if (data.detail && data.detail.draft_info) {
        const draftInfo = data.detail.draft_info;
        videoUrl = data.video_url || draftInfo.url;
        thumbnailUrl = data.thumbnail_url || draftInfo.encodings?.thumbnail?.path;
        gifUrl = data.gif_url || draftInfo.encodings?.gif?.path;
        width = draftInfo.width;
        height = draftInfo.height;
        generationId = draftInfo.generation_id;
      }
      
      let errorMessage = null;
      let errorKind = null;
      
      if (status === 'failed') {
        const rawError = data.error || 
                        data.detail?.draft_info?.reason_str || 
                        data.detail?.pending_info?.failure_reason;
        
        errorKind = data.detail?.draft_info?.kind;
        
        if (rawError) {
          errorMessage = this.translateErrorMessage(rawError, errorKind);
          
          logger.warn('Sora2任务失败', {
            taskId,
            model: config.model_name,
            kind: errorKind,
            rawError,
            translatedError: errorMessage
          });
        } else {
          errorMessage = '视频生成失败，未返回具体原因';
        }
      }
      
      let progress = 0;
      if (status === 'succeeded') {
        progress = 100;
      } else if (status === 'running') {
        progress = data.detail?.pending_info?.progress_pct 
          ? parseInt(data.detail.pending_info.progress_pct * 100) 
          : 50;
      } else if (status === 'failed') {
        progress = 0;
      }
      
      return {
        status,
        progress,
        videoUrl,
        thumbnailUrl,
        gifUrl,
        width,
        height,
        generationId,
        errorMessage,
        rawResponse: data
      };
    } catch (error) {
      logger.error('查询Sora2任务状态失败:', {
        taskId,
        error: error.message,
        response: error.response?.data
      });
      
      throw error;
    }
  }

  /**
   * 下载并保存视频到OSS
   */
  async downloadAndSaveVideo(videoUrl, thumbnailUrl, gifUrl, userId, generationId) {
    try {
      logger.info('开始下载Sora2视频到OSS', {
        videoUrl: videoUrl?.substring(0, 100) + '...',
        userId,
        generationId
      });
      
      await ossService.initialize();
      
      const dateFolder = new Date().toISOString().slice(0, 7);
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      
      let ossVideoUrl = null;
      let fileSize = 0;
      
      if (videoUrl) {
        const videoResponse = await axios.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 180000,
          maxContentLength: 500 * 1024 * 1024,
          maxBodyLength: 500 * 1024 * 1024
        });
        
        const videoBuffer = Buffer.from(videoResponse.data);
        fileSize = videoBuffer.length;
        
        const videoFileName = `sora2_video_${generationId}_${timestamp}_${random}.mp4`;
        const videoOssKey = `videos/${userId}/${dateFolder}/${videoFileName}`;
        
        const videoUploadResult = await ossService.uploadFile(videoBuffer, videoOssKey, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `inline; filename="${videoFileName}"`
          }
        });
        
        ossVideoUrl = videoUploadResult.url;
        
        logger.info('Sora2视频已保存到OSS', {
          generationId,
          ossKey: videoOssKey,
          size: fileSize
        });
      }
      
      let ossThumbnailUrl = null;
      if (thumbnailUrl) {
        try {
          const thumbResponse = await axios.get(thumbnailUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
          });
          
          const thumbBuffer = Buffer.from(thumbResponse.data);
          const thumbFileName = `sora2_thumb_${generationId}_${timestamp}_${random}.webp`;
          const thumbOssKey = `videos/${userId}/${dateFolder}/${thumbFileName}`;
          
          const thumbUploadResult = await ossService.uploadFile(thumbBuffer, thumbOssKey, {
            headers: {
              'Content-Type': 'image/webp',
              'Content-Disposition': `inline; filename="${thumbFileName}"`
            }
          });
          
          ossThumbnailUrl = thumbUploadResult.url;
          
          logger.info('Sora2缩略图已保存到OSS', { generationId });
        } catch (error) {
          logger.warn('下载Sora2缩略图失败，使用视频URL', { 
            error: error.message 
          });
          ossThumbnailUrl = ossVideoUrl;
        }
      }
      
      let ossGifUrl = null;
      if (gifUrl) {
        try {
          const gifResponse = await axios.get(gifUrl, {
            responseType: 'arraybuffer',
            timeout: 60000
          });
          
          const gifBuffer = Buffer.from(gifResponse.data);
          const gifFileName = `sora2_preview_${generationId}_${timestamp}_${random}.gif`;
          const gifOssKey = `videos/${userId}/${dateFolder}/${gifFileName}`;
          
          const gifUploadResult = await ossService.uploadFile(gifBuffer, gifOssKey, {
            headers: {
              'Content-Type': 'image/gif',
              'Content-Disposition': `inline; filename="${gifFileName}"`
            }
          });
          
          ossGifUrl = gifUploadResult.url;
          
          logger.info('Sora2 GIF预览已保存到OSS', { generationId });
        } catch (error) {
          logger.warn('下载Sora2 GIF预览失败', { 
            error: error.message 
          });
        }
      }
      
      return {
        localPath: ossVideoUrl,
        thumbnailPath: ossThumbnailUrl || ossVideoUrl,
        previewGifPath: ossGifUrl,
        fileSize,
        width: null,
        height: null,
        duration: null
      };
      
    } catch (error) {
      logger.error('下载保存Sora2视频失败:', {
        generationId,
        userId,
        error: error.message
      });
      throw new Error('保存视频失败: ' + error.message);
    }
  }

  /**
   * 转换任务状态
   */
  convertTaskStatus(sora2Status) {
    const statusMap = {
      'pending': 'queued',
      'running': 'running',
      'completed': 'succeeded',
      'failed': 'failed',
      'processing': 'running'
    };
    
    return statusMap[sora2Status] || sora2Status;
  }
}

module.exports = new Sora2VideoService();
