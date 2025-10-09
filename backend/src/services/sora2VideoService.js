/**
 * Sora 2 视频生成服务 (GoAPI Provider)
 * 处理与GoAPI Sora2 API的交互
 * 
 * API文档参考:
 * - 创建: POST /sora2/v1/create
 * - 查询: GET /sora2/v1/query?id={task_id}
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
   * @returns {string} orientation (portrait, landscape, square)
   */
  convertRatioToOrientation(ratio) {
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
   * @param {string} errorMessage 英文错误信息
   * @param {string} kind 错误类型
   * @returns {string} 中文错误信息
   */
  translateErrorMessage(errorMessage, kind) {
    // 如果没有错误信息，返回通用提示
    if (!errorMessage) {
      return '视频生成失败，请稍后重试';
    }

    // 常见错误类型映射
    const errorTranslations = {
      // 内容审核相关
      'sora_content_violation': '内容审核未通过',
      'content_policy_violation': '违反内容政策',
      
      // 具体错误信息翻译
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
        
      // 技术错误
      'Invalid input': '输入参数无效',
      'Rate limit exceeded': 'API调用频率超限，请稍后重试',
      'Insufficient credits': '账户余额不足',
      'Service unavailable': '服务暂时不可用，请稍后重试',
      'Timeout': '生成超时，请重试',
      'Internal server error': '服务器内部错误，请稍后重试'
    };

    // 先尝试精确匹配
    if (errorTranslations[errorMessage]) {
      return errorTranslations[errorMessage];
    }

    // 再尝试kind类型匹配
    if (kind && errorTranslations[kind]) {
      return `${errorTranslations[kind]}：${errorMessage}`;
    }

    // 关键词匹配
    const lowerError = errorMessage.toLowerCase();
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

    // 如果都不匹配，返回原始错误（加上提示）
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
      
      // 构建请求参数
      const requestData = {
        model: 'sora-2',
        orientation: this.convertRatioToOrientation(params.ratio || '16:9'),
        prompt: params.prompt
      };
      
      logger.info('提交Sora2纯文本视频任务', {
        orientation: requestData.orientation,
        promptLength: params.prompt.length
      });
      
      const response = await axios.post(
        `${config.base_url}${config.create_endpoint}`,
        requestData,
        { 
          headers, 
          timeout: 30000 
        }
      );
      
      // 处理响应
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
      
      // 处理API错误
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
      
      // 构建请求参数
      const requestData = {
        model: 'sora-2',
        orientation: this.convertRatioToOrientation(params.ratio || '16:9'),
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
        orientation: requestData.orientation,
        imageCount: requestData.images.length,
        promptLength: params.prompt.length
      });
      
      const response = await axios.post(
        `${config.base_url}${config.create_endpoint}`,
        requestData,
        { 
          headers, 
          timeout: 30000 
        }
      );
      
      // 处理响应
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
      
      // 处理API错误
      if (error.response?.data?.error) {
        const translatedError = this.translateErrorMessage(error.response.data.error);
        throw new Error(translatedError);
      }
      
      throw error;
    }
  }

  /**
   * 查询任务状态
   * @param {string} taskId 任务ID (格式: sora-2:task_xxx)
   * @param {object} model 模型配置
   * @returns {object} 任务状态信息
   */
  async queryTaskStatus(taskId, model) {
    try {
      const config = this.parseModelConfig(model);
      const headers = this.getHeaders(config.api_key);
      
      // URL编码任务ID中的冒号
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
      
      // 转换状态
      const status = this.convertTaskStatus(data.status);
      
      // 提取视频URL和其他信息
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
      
      // ✅ 修复：正确提取错误信息
      let errorMessage = null;
      let errorKind = null;
      
      if (status === 'failed') {
        // 从多个可能的位置提取错误信息
        const rawError = data.error || 
                        data.detail?.draft_info?.reason_str || 
                        data.detail?.pending_info?.failure_reason;
        
        // 提取错误类型
        errorKind = data.detail?.draft_info?.kind;
        
        // 翻译错误信息为中文
        if (rawError) {
          errorMessage = this.translateErrorMessage(rawError, errorKind);
          
          logger.warn('Sora2任务失败', {
            taskId,
            kind: errorKind,
            rawError,
            translatedError: errorMessage
          });
        } else {
          errorMessage = '视频生成失败，未返回具体原因';
        }
      }
      
      // 计算进度
      let progress = 0;
      if (status === 'succeeded') {
        progress = 100;
      } else if (status === 'running') {
        // 尝试从detail中获取进度
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
        errorMessage,  // ✅ 现在包含翻译后的中文错误信息
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
   * @param {string} videoUrl 视频URL
   * @param {string} thumbnailUrl 缩略图URL
   * @param {string} gifUrl GIF预览URL
   * @param {number} userId 用户ID
   * @param {number} generationId 生成记录ID
   * @returns {object} 保存结果
   */
  async downloadAndSaveVideo(videoUrl, thumbnailUrl, gifUrl, userId, generationId) {
    try {
      logger.info('开始下载Sora2视频到OSS', {
        videoUrl: videoUrl?.substring(0, 100) + '...',
        userId,
        generationId
      });
      
      // 初始化OSS服务
      await ossService.initialize();
      
      // 生成文件名
      const dateFolder = new Date().toISOString().slice(0, 7); // YYYY-MM
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      
      // 下载视频
      let ossVideoUrl = null;
      let fileSize = 0;
      
      if (videoUrl) {
        const videoResponse = await axios.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 180000, // 3分钟超时
          maxContentLength: 500 * 1024 * 1024, // 最大500MB
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
      
      // 下载缩略图
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
          ossThumbnailUrl = ossVideoUrl; // 使用视频URL作为fallback
        }
      }
      
      // 下载GIF预览
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
        width: null,  // TODO: 从视频元数据获取
        height: null, // TODO: 从视频元数据获取
        duration: null // TODO: 从视频元数据获取
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
   * @param {string} sora2Status Sora2的状态
   * @returns {string} 系统统一的状态
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

// 导出单例
module.exports = new Sora2VideoService();
