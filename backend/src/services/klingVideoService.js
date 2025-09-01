/**
 * 可灵（Kling）视频生成服务
 * 处理与可灵API的交互
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const ossService = require('./ossService');
const redis = require('../database/redis');

class KlingVideoService {
  constructor() {
    this.baseUrl = 'https://api-beijing.klingai.com';
    this.tokenCache = new Map(); // 内存缓存JWT Token
  }

  /**
   * 生成JWT Token
   * @param {string} accessKey 
   * @param {string} secretKey 
   * @returns {string} JWT Token
   */
  generateJWTToken(accessKey, secretKey) {
    try {
      // 检查缓存
      const cacheKey = `kling_token_${accessKey}`;
      const cached = this.tokenCache.get(cacheKey);
      
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
      }

      // 生成新Token
      const headers = {
        alg: 'HS256',
        typ: 'JWT'
      };

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: accessKey,
        exp: now + 1800, // 30分钟有效期
        nbf: now - 5     // 提前5秒生效
      };

      const token = jwt.sign(payload, secretKey, { header: headers });
      
      // 缓存Token（提前5分钟过期，确保安全）
      this.tokenCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + (25 * 60 * 1000) // 25分钟
      });

      logger.info('生成可灵JWT Token成功', { accessKey: accessKey.substring(0, 8) + '...' });
      return token;
    } catch (error) {
      logger.error('生成可灵JWT Token失败:', error);
      throw new Error('生成认证Token失败');
    }
  }

  /**
   * 获取请求头
   * @param {object} model 模型配置
   */
  getHeaders(model) {
    const config = this.parseApiConfig(model.api_config);
    const token = this.generateJWTToken(config.access_key, config.secret_key);
    
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  /**
   * 解析API配置
   * @param {string|object} apiConfig 
   */
  parseApiConfig(apiConfig) {
    try {
      const config = typeof apiConfig === 'string' ? JSON.parse(apiConfig) : apiConfig;
      return {
        access_key: config.access_key,
        secret_key: config.secret_key,
        model_version: config.model_version || 'kling-v1-6',
        mode: config.mode || 'std'
      };
    } catch (error) {
      logger.error('解析可灵API配置失败:', error);
      throw new Error('API配置格式错误');
    }
  }

  /**
   * 提交文生视频任务
   * @param {object} model 模型配置
   * @param {object} params 生成参数
   */
  async submitText2Video(model, params) {
    try {
      const config = this.parseApiConfig(model.api_config);
      const headers = this.getHeaders(model);

      // 构建请求参数
      const requestData = {
        model_name: config.model_version,
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        mode: params.mode || config.mode || 'std',
        duration: String(params.duration || 5),
        aspect_ratio: this.convertRatio(params.ratio || '16:9'),
        cfg_scale: params.cfg_scale || 0.5
      };

      // 添加运镜控制（如果有）
      if (params.camera_control) {
        requestData.camera_control = this.buildCameraControl(params.camera_control);
      }

      logger.info('提交可灵文生视频任务', {
        model_version: config.model_version,
        mode: requestData.mode,
        duration: requestData.duration,
        aspect_ratio: requestData.aspect_ratio
      });

      const response = await axios.post(
        `${this.baseUrl}/v1/videos/text2video`,
        requestData,
        { headers, timeout: 30000 }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || '可灵API返回错误');
      }

      return {
        taskId: response.data.data.task_id,
        status: response.data.data.task_status,
        externalTaskId: response.data.data.task_info?.external_task_id
      };
    } catch (error) {
      logger.error('提交可灵文生视频任务失败:', error);
      
      // 处理特定错误码
      if (error.response?.data?.code) {
        const errorCode = error.response.data.code;
        const errorMsg = this.getErrorMessage(errorCode);
        throw new Error(errorMsg);
      }
      
      throw error;
    }
  }

  /**
   * 提交图生视频任务
   * @param {object} model 模型配置
   * @param {object} params 生成参数
   */
  async submitImage2Video(model, params) {
    try {
      const config = this.parseApiConfig(model.api_config);
      const headers = this.getHeaders(model);

      // 构建请求参数
      const requestData = {
        model_name: config.model_version,
        image: params.first_frame_image, // 首帧图片URL
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        mode: params.mode || config.mode || 'std',
        duration: String(params.duration || 5),
        cfg_scale: params.cfg_scale || 0.5
      };

      // 如果有尾帧图片
      if (params.last_frame_image) {
        requestData.image_tail = params.last_frame_image;
      }

      logger.info('提交可灵图生视频任务', {
        model_version: config.model_version,
        mode: requestData.mode,
        has_tail_frame: !!params.last_frame_image
      });

      const response = await axios.post(
        `${this.baseUrl}/v1/videos/image2video`,
        requestData,
        { headers, timeout: 30000 }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || '可灵API返回错误');
      }

      return {
        taskId: response.data.data.task_id,
        status: response.data.data.task_status,
        externalTaskId: response.data.data.task_info?.external_task_id
      };
    } catch (error) {
      logger.error('提交可灵图生视频任务失败:', error);
      
      // 处理特定错误码
      if (error.response?.data?.code) {
        const errorCode = error.response.data.code;
        const errorMsg = this.getErrorMessage(errorCode);
        throw new Error(errorMsg);
      }
      
      throw error;
    }
  }

  /**
   * 查询任务状态
   * @param {string} taskId 可灵任务ID
   * @param {object} model 模型配置
   */
  async queryTaskStatus(taskId, model) {
    try {
      const headers = this.getHeaders(model);
      
      const response = await axios.get(
        `${this.baseUrl}/v1/videos/text2video/${taskId}`,
        { headers, timeout: 10000 }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || '查询任务状态失败');
      }

      const data = response.data.data;
      
      // 转换状态格式
      const status = this.convertTaskStatus(data.task_status);
      
      // 获取视频URL
      let videoUrl = null;
      if (data.task_result?.videos?.length > 0) {
        videoUrl = data.task_result.videos[0].url;
      }

      return {
        status,
        progress: status === 'succeeded' ? 100 : (status === 'running' ? 50 : 0),
        videoUrl,
        duration: data.task_result?.videos?.[0]?.duration,
        errorMessage: data.task_status_msg
      };
    } catch (error) {
      logger.error('查询可灵任务状态失败:', {
        taskId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 下载并保存视频到OSS
   * @param {string} videoUrl 可灵返回的视频URL
   * @param {number} userId 用户ID
   * @param {number} generationId 生成记录ID
   */
  async downloadAndSaveVideo(videoUrl, userId, generationId) {
    try {
      logger.info('开始下载可灵视频', {
        url: videoUrl.substring(0, 100) + '...',
        userId,
        generationId
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
      const fileName = `kling_video_${generationId}_${timestamp}_${random}.mp4`;
      
      // 构建OSS key
      const ossKey = `videos/${userId}/${dateFolder}/${fileName}`;
      
      // 上传到OSS
      const uploadResult = await ossService.uploadFile(videoBuffer, ossKey, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `inline; filename="${fileName}"`
        }
      });
      
      logger.info('可灵视频已保存到OSS', {
        generationId,
        userId,
        ossKey,
        url: uploadResult.url
      });
      
      // 返回完整的结果对象，确保所有字段都有值（使用null而不是undefined）
      return {
        localPath: uploadResult.url,
        thumbnailPath: uploadResult.url, // TODO: 生成缩略图
        previewGifPath: null, // 明确设置为null而不是undefined
        fileSize: videoBuffer.length,
        width: 1920,  // TODO: 从视频元数据获取实际宽度
        height: 1080, // TODO: 从视频元数据获取实际高度
        duration: null // TODO: 从视频元数据获取实际时长
      };
    } catch (error) {
      logger.error('下载保存可灵视频失败', {
        generationId,
        userId,
        error: error.message
      });
      throw new Error('保存视频失败: ' + error.message);
    }
  }

  /**
   * 转换宽高比格式
   * @param {string} ratio 如 "16:9"
   * @returns {string} 如 "16:9" (可灵支持的格式)
   */
  convertRatio(ratio) {
    // 可灵支持的宽高比：16:9, 9:16, 1:1
    const supportedRatios = ['16:9', '9:16', '1:1'];
    
    if (supportedRatios.includes(ratio)) {
      return ratio;
    }
    
    // 映射其他比例到最接近的支持比例
    const ratioMap = {
      '4:3': '16:9',
      '3:4': '9:16',
      '21:9': '16:9',
      '3:2': '16:9',
      '2:3': '9:16'
    };
    
    return ratioMap[ratio] || '16:9';
  }

  /**
   * 构建运镜控制参数
   * @param {object} cameraControl 
   */
  buildCameraControl(cameraControl) {
    if (!cameraControl) return null;
    
    // 简单运镜模式
    if (cameraControl.type === 'simple') {
      return {
        type: 'simple',
        config: {
          horizontal: cameraControl.horizontal || 0,
          vertical: cameraControl.vertical || 0,
          pan: cameraControl.pan || 0,
          tilt: cameraControl.tilt || 0,
          roll: cameraControl.roll || 0,
          zoom: cameraControl.zoom || 0
        }
      };
    }
    
    // 预设运镜模式
    return {
      type: cameraControl.type
    };
  }

  /**
   * 转换任务状态
   * @param {string} klingStatus 可灵的状态
   * @returns {string} 系统统一的状态
   */
  convertTaskStatus(klingStatus) {
    const statusMap = {
      'submitted': 'submitted',
      'processing': 'running',
      'succeed': 'succeeded',
      'failed': 'failed'
    };
    
    return statusMap[klingStatus] || klingStatus;
  }

  /**
   * 获取错误信息
   * @param {number} code 错误码
   */
  getErrorMessage(code) {
    const errorMap = {
      1000: '身份验证失败，请检查API密钥',
      1001: 'Authorization为空',
      1002: 'Authorization值非法',
      1003: 'Token未到有效时间',
      1004: 'Token已失效',
      1100: '账户异常',
      1101: '账户欠费',
      1102: '资源包已用完或已过期',
      1103: '无权限访问该资源',
      1200: '请求参数非法',
      1201: '参数非法',
      1202: '请求方法无效',
      1203: '请求的资源不存在',
      1300: '触发平台策略',
      1301: '触发内容安全策略',
      1302: 'API请求过快，请稍后重试',
      1303: '并发或QPS超限',
      1304: '触发IP白名单策略',
      5000: '服务器内部错误',
      5001: '服务器暂时不可用',
      5002: '服务器内部超时'
    };
    
    return errorMap[code] || `API错误(${code})`;
  }

  /**
   * 清理过期的Token缓存
   */
  cleanupTokenCache() {
    const now = Date.now();
    for (const [key, value] of this.tokenCache.entries()) {
      if (value.expiresAt < now) {
        this.tokenCache.delete(key);
      }
    }
  }
}

// 定期清理Token缓存
const klingService = new KlingVideoService();
setInterval(() => {
  klingService.cleanupTokenCache();
}, 5 * 60 * 1000); // 每5分钟清理一次

module.exports = klingService;
