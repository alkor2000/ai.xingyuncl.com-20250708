/**
 * 图像生成服务
 * 处理与火山方舟API的交互
 * 支持OSS存储、用户目录隔离和图生图功能
 * 
 * 更新记录：
 * - 2025-12-23: 支持Seedream系列模型自动识别（包括4.0、4.5等版本）
 */

const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const User = require('../models/User');
const ossService = require('./ossService');
const logger = require('../utils/logger');
const config = require('../config');

class ImageService {
  /**
   * 判断是否为Seedream系列模型
   * 支持所有版本：doubao-seedream-4-0、doubao-seedream-4-5等
   * @param {object} model - 模型对象
   * @returns {boolean}
   */
  static isSeedreamModel(model) {
    if (!model || !model.model_id) return false;
    // 匹配所有doubao-seedream开头的模型
    return model.provider === 'volcano' && model.model_id.startsWith('doubao-seedream');
  }

  /**
   * 获取Seedream模型版本号
   * @param {string} modelId - 模型ID
   * @returns {string} 版本号，如 "4.0", "4.5"
   */
  static getSeedreamVersion(modelId) {
    if (!modelId) return '4.0';
    // 从 doubao-seedream-4-5-251128 提取 4.5
    const match = modelId.match(/doubao-seedream-(\d+)-(\d+)/);
    if (match) {
      return `${match[1]}.${match[2]}`;
    }
    return '4.0';
  }

  /**
   * 将标准尺寸转换为Seedream API格式
   * Seedream 4.5要求最低2560x1440（约368万像素）
   * @param {string} size - 原始尺寸参数
   * @param {string} version - Seedream版本号
   * @returns {string} API接受的尺寸格式
   */
  static convertSizeForSeedream(size, version = '4.0') {
    // Seedream系列使用特殊的尺寸格式：2K、4K
    const sizeMapping = {
      // 标准尺寸映射到2K或4K
      '1024x1024': '2K',
      '2048x2048': '4K',
      '864x1152': '2K',
      '1152x864': '2K',
      '1280x720': '2K',
      '720x1280': '2K',
      '832x1248': '2K',
      '1248x832': '2K',
      '1512x648': '2K',
      // 直接支持2K/4K格式
      '2K': '2K',
      '4K': '4K',
      // 比例格式也映射到2K
      '1:1': '2K',
      '4:3': '2K',
      '3:4': '2K',
      '16:9': '2K',
      '9:16': '2K'
    };
    
    return sizeMapping[size] || '2K';  // 默认使用2K
  }

  /**
   * 批量生成图片
   * @param {number} userId - 用户ID
   * @param {number} modelId - 模型ID
   * @param {object} params - 生成参数
   * @param {number} quantity - 生成数量(1-4)
   * @returns {array} 生成结果数组
   */
  static async generateImages(userId, modelId, params, quantity = 1) {
    // 限制数量在1-4之间
    const actualQuantity = Math.min(Math.max(1, quantity), 4);
    
    try {
      // 1. 获取模型配置
      const model = await ImageModel.findById(modelId);
      if (!model || !model.is_active) {
        throw new Error('模型不存在或未启用');
      }

      // 2. 获取用户信息并检查积分
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('用户不存在');
      }

      // Midjourney特殊处理：每次生成4张图
      const isMidjourney = model.provider === 'midjourney';
      let effectiveQuantity = actualQuantity;
      let pricePerImage = parseFloat(model.price_per_image) || 1;
      
      if (isMidjourney) {
        // Midjourney固定生成1次（产生4张图的网格）
        effectiveQuantity = 1;
        // 积分按4张计算
        const gridSize = model.api_config?.grid_size || 4;
        pricePerImage = pricePerImage * gridSize;
      }

      // 检查积分是否充足
      const requiredCredits = pricePerImage * effectiveQuantity;
      
      if (!user.hasCredits(requiredCredits)) {
        throw new Error(`积分不足，需要 ${requiredCredits} 积分`);
      }

      logger.info('开始批量生成图片', {
        userId,
        modelId,
        quantity: effectiveQuantity,
        pricePerImage,
        requiredCredits,
        isMidjourney,
        isSeedream: this.isSeedreamModel(model),
        hasReferenceImages: params.reference_images && params.reference_images.length > 0
      });

      // 3. 并发生成多张图片
      const generatePromises = [];
      for (let i = 0; i < effectiveQuantity; i++) {
        // 每张图片使用不同的种子（如果原始种子是-1则随机，否则递增）
        const seed = params.seed === -1 || params.seed === undefined 
          ? -1 
          : (params.seed + i);
        
        generatePromises.push(
          this.generateSingleImage(userId, modelId, { ...params, seed }, model, i + 1)
        );
      }

      // 并发执行所有生成请求
      const results = await Promise.allSettled(generatePromises);
      
      // 统计成功和失败的结果
      const successResults = [];
      const failedResults = [];
      let totalConsumedCredits = 0;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successResults.push(result.value.data);
          totalConsumedCredits += pricePerImage;
        } else {
          failedResults.push({
            index: index + 1,
            error: result.reason?.message || result.value?.error || '生成失败'
          });
        }
      });

      // 4. 扣除积分（按实际成功数量）
      if (successResults.length > 0) {
        const displayName = isMidjourney 
          ? `Midjourney图像生成 - ${model.display_name}`
          : params.reference_images && params.reference_images.length > 0
          ? `图生图 - ${model.display_name} × ${successResults.length}张`
          : `批量图像生成 - ${model.display_name} × ${successResults.length}张`;
          
        await user.consumeCredits(
          totalConsumedCredits,
          null,
          null,
          displayName,
          'image_consume'
        );
      }

      logger.info('批量生成完成', {
        userId,
        requested: effectiveQuantity,
        succeeded: successResults.length,
        failed: failedResults.length,
        creditsConsumed: totalConsumedCredits
      });

      return {
        success: true,
        requested: effectiveQuantity,
        succeeded: successResults.length,
        failed: failedResults.length,
        creditsConsumed: totalConsumedCredits,
        results: successResults,
        errors: failedResults
      };

    } catch (error) {
      logger.error('批量生成图片失败', {
        userId,
        modelId,
        quantity: actualQuantity,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 生成单张图片（内部方法）
   */
  static async generateSingleImage(userId, modelId, params, model, index = 1) {
    const startTime = Date.now();
    let generationId = null;
    
    try {
      // 判断是否为Midjourney
      const isMidjourney = model.provider === 'midjourney';
      // 判断是否为Seedream系列模型（包括4.0、4.5等所有版本）
      const isSeedream = this.isSeedreamModel(model);
      const seedreamVersion = isSeedream ? this.getSeedreamVersion(model.model_id) : null;
      
      // 1. 创建生成记录
      const creditsToConsume = isMidjourney 
        ? parseFloat(model.price_per_image) * (model.api_config?.grid_size || 4)
        : parseFloat(model.price_per_image) || 1;
      
      const generationData = {
        user_id: userId,
        model_id: modelId,
        prompt: params.prompt,
        negative_prompt: params.negative_prompt || '',
        size: params.size || model.default_size,
        seed: params.seed || -1,
        guidance_scale: params.guidance_scale || model.default_guidance_scale,
        watermark: params.watermark !== false,
        status: 'generating',
        credits_consumed: creditsToConsume
      };
      
      // 如果有参考图片，记录在备注中
      if (params.reference_images && params.reference_images.length > 0) {
        generationData.reference_images = JSON.stringify(params.reference_images);
      }
      
      // Midjourney特殊字段
      if (isMidjourney) {
        generationData.action_type = 'IMAGINE';
        generationData.generation_mode = params.mode || 'fast';
        generationData.grid_layout = 1; // 标记为4图网格
      }
      
      generationId = await ImageGeneration.create(generationData);

      // 2. 调用API生成图片
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      if (!apiKey) {
        throw new Error('API密钥未配置');
      }

      // 构建请求数据
      let requestData;
      let requestUrl = model.endpoint;
      
      if (isMidjourney) {
        // Midjourney API的请求格式
        requestData = {
          prompt: params.prompt,
          action: 'IMAGINE',
          index: 0
        };
        
        // 如果有比例参数，添加到prompt中
        if (params.size && params.size !== '1:1' && params.size !== '1024x1024') {
          requestData.prompt += ` --ar ${params.size}`;
        }
      } else if (isSeedream) {
        // 火山引擎Seedream系列模型（4.0、4.5等）的统一请求格式
        requestData = {
          model: model.model_id,
          prompt: params.prompt
        };
        
        // 添加参考图片（图生图功能）
        if (params.reference_images && params.reference_images.length > 0) {
          // Seedream使用image参数传递参考图片URL数组
          requestData.image = params.reference_images;
          
          // 如果配置了连续图像生成选项
          const apiConfig = model.api_config || {};
          if (apiConfig.sequential_image_generation) {
            requestData.sequential_image_generation = apiConfig.sequential_image_generation;
            if (apiConfig.sequential_image_generation_options) {
              requestData.sequential_image_generation_options = apiConfig.sequential_image_generation_options;
            }
          }
          
          logger.info('使用图生图模式', {
            modelId: model.model_id,
            seedreamVersion,
            referenceImages: params.reference_images.length,
            sequential: requestData.sequential_image_generation
          });
        }
        
        // 处理尺寸参数 - 使用统一的转换方法
        requestData.size = this.convertSizeForSeedream(params.size, seedreamVersion);
        
        // 设置响应格式
        requestData.response_format = 'url';
        
        // 添加流式响应（暂时不使用，简化处理）
        requestData.stream = false;
        
        // 添加水印设置
        requestData.watermark = params.watermark !== false;
        
        // 如果有负向提示词，添加到请求中（图生图模式下可能不支持）
        if (params.negative_prompt && !params.reference_images) {
          requestData.prompt = `${params.prompt}, avoid: ${params.negative_prompt}`;
        }
        
        // 如果提供了引导系数，转换为cfg_scale
        if (params.guidance_scale) {
          requestData.cfg_scale = params.guidance_scale;
        }
        
        // 如果提供了种子值
        if (params.seed && params.seed !== -1) {
          requestData.seed = params.seed;
        }
        
        logger.info('使用Seedream API格式', {
          modelId: model.model_id,
          seedreamVersion,
          hasReferenceImages: !!requestData.image,
          size: requestData.size,
          requestData: {
            ...requestData,
            prompt: requestData.prompt.substring(0, 100) + '...',
            image: requestData.image ? `[${requestData.image.length} images]` : undefined
          }
        });
      } else {
        // 普通火山引擎模型的请求格式
        requestData = {
          model: model.model_id,
          prompt: params.prompt,
          response_format: 'url',
          size: params.size || model.default_size,
          seed: params.seed || -1,
          guidance_scale: params.guidance_scale || model.default_guidance_scale,
          watermark: params.watermark !== false
        };
        
        // 添加负向提示词（如果有）
        if (params.negative_prompt) {
          requestData.negative_prompt = params.negative_prompt;
        }
      }

      logger.info(`生成第${index}张图片`, {
        userId,
        modelId,
        generationId,
        creditsToConsume,
        isMidjourney,
        isSeedream,
        seedreamVersion,
        provider: model.provider,
        modelName: model.name,
        isImage2Image: params.reference_images && params.reference_images.length > 0
      });

      const response = await axios.post(
        requestUrl,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: isMidjourney ? 300000 : 60000,  // Midjourney需要更长超时
          validateStatus: function (status) {
            // 允许记录详细的错误响应
            return status >= 200 && status < 500;
          }
        }
      );

      // 检查响应状态
      if (response.status !== 200) {
        logger.error('API返回错误', {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
          modelId: model.model_id,
          provider: model.provider,
          isSeedream,
          seedreamVersion
        });
        
        // 尝试从响应中提取错误信息
        let errorMessage = `API返回错误: ${response.status}`;
        if (response.data) {
          if (response.data.error) {
            errorMessage = response.data.error.message || response.data.error;
          } else if (response.data.message) {
            errorMessage = response.data.message;
          } else if (response.data.msg) {
            errorMessage = response.data.msg;
          }
        }
        throw new Error(errorMessage);
      }

      // 解析响应
      let imageUrl;
      if (isMidjourney) {
        // Midjourney API响应格式
        if (!response.data || response.data.code !== 1) {
          throw new Error(response.data?.msg || 'Midjourney API调用失败');
        }
        const resultData = response.data.data;
        imageUrl = resultData.imageUrl || resultData.image_url || resultData.url;
        
        if (!imageUrl) {
          throw new Error('Midjourney API未返回图片URL');
        }
      } else {
        // 火山引擎API响应格式（包括Seedream系列）
        if (!response.data || !response.data.data || !response.data.data[0]) {
          logger.error('API响应格式错误', {
            responseData: response.data,
            modelId: model.model_id,
            isSeedream,
            seedreamVersion
          });
          throw new Error('API返回数据格式错误');
        }
        imageUrl = response.data.data[0].url;
      }
      
      // 3. 下载图片并保存（使用OSS服务，支持用户目录隔离）
      const { localPath, thumbnailPath, fileSize } = await this.downloadAndSaveImage(
        imageUrl,
        generationId,
        userId  // 传递userId用于目录隔离
      );

      // 4. 更新生成记录
      const generationTime = Date.now() - startTime;
      const updateData = {
        image_url: imageUrl,
        local_path: localPath,
        thumbnail_path: thumbnailPath,
        file_size: fileSize,
        status: 'success',
        generation_time: generationTime
      };
      
      // Midjourney特殊处理：添加按钮数据
      if (isMidjourney) {
        updateData.task_status = 'SUCCESS';
        updateData.task_id = response.data?.data?.task_id || `mj_${generationId}`;
        updateData.buttons = JSON.stringify([
          { type: 'UPSCALE', label: 'U1', customId: 'U1' },
          { type: 'UPSCALE', label: 'U2', customId: 'U2' },
          { type: 'UPSCALE', label: 'U3', customId: 'U3' },
          { type: 'UPSCALE', label: 'U4', customId: 'U4' },
          { type: 'VARIATION', label: 'V1', customId: 'V1' },
          { type: 'VARIATION', label: 'V2', customId: 'V2' },
          { type: 'VARIATION', label: 'V3', customId: 'V3' },
          { type: 'VARIATION', label: 'V4', customId: 'V4' },
          { type: 'REROLL', label: '🔄', customId: 'REROLL' }
        ]);
      }
      
      await ImageGeneration.update(generationId, updateData);

      const result = await ImageGeneration.findById(generationId);
      
      return {
        success: true,
        data: result
      };

    } catch (error) {
      logger.error(`生成第${index}张图片失败`, {
        userId,
        modelId,
        generationId,
        error: error.message,
        stack: error.stack
      });

      // 更新失败状态
      if (generationId) {
        const updateData = {
          status: 'failed',
          error_message: error.message,
          generation_time: Date.now() - startTime
        };
        
        if (model.provider === 'midjourney') {
          updateData.task_status = 'FAILURE';
        }
        
        await ImageGeneration.update(generationId, updateData);
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 生成图片（保留原方法兼容性）
   */
  static async generateImage(userId, modelId, params) {
    // 调用批量生成方法，数量为1
    const result = await this.generateImages(userId, modelId, params, 1);
    
    if (result.succeeded > 0) {
      return result.results[0];
    } else {
      throw new Error(result.errors[0]?.error || '生成失败');
    }
  }

  /**
   * 下载并保存图片
   * 改进：使用OSS服务，支持用户目录隔离
   * @param {string} imageUrl - 图片URL
   * @param {number} generationId - 生成记录ID
   * @param {number} userId - 用户ID（用于目录隔离）
   */
  static async downloadAndSaveImage(imageUrl, generationId, userId) {
    try {
      // 下载图片
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const imageBuffer = Buffer.from(response.data);
      
      // 初始化OSS服务（自动判断使用本地还是OSS）
      await ossService.initialize();
      
      // 生成文件名和路径（包含用户ID以实现隔离）
      const dateFolder = new Date().toISOString().slice(0, 7); // YYYY-MM
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const fileName = `gen_${generationId}_${timestamp}_${random}.jpg`;
      const thumbFileName = `thumb_${generationId}_${timestamp}_${random}.jpg`;
      
      // 构建OSS key：generations/{userId}/{YYYY-MM}/filename
      const ossKey = `generations/${userId}/${dateFolder}/${fileName}`;
      const thumbOssKey = `generations/${userId}/${dateFolder}/${thumbFileName}`;
      
      // 生成缩略图
      const thumbnailBuffer = await sharp(imageBuffer)
        .resize(400, 400, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      // 上传原图到OSS（会自动判断使用OSS还是本地存储）
      const uploadResult = await ossService.uploadFile(imageBuffer, ossKey, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `inline; filename="${fileName}"`
        }
      });
      
      // 上传缩略图到OSS
      const thumbResult = await ossService.uploadFile(thumbnailBuffer, thumbOssKey, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `inline; filename="${thumbFileName}"`
        }
      });
      
      logger.info('图片已保存', {
        generationId,
        userId,
        ossKey,
        thumbOssKey,
        isLocal: uploadResult.isLocal,
        url: uploadResult.url
      });
      
      // 返回访问路径
      // 如果是本地存储，URL格式为 /storage/uploads/generations/...
      // 如果是OSS存储，URL为完整的OSS URL
      return {
        localPath: uploadResult.url,  // 这里存储的是完整URL或本地路径
        thumbnailPath: thumbResult.url,
        fileSize: imageBuffer.length
      };
      
    } catch (error) {
      logger.error('下载保存图片失败', {
        imageUrl,
        generationId,
        userId,
        error: error.message
      });
      throw new Error('保存图片失败: ' + error.message);
    }
  }

  /**
   * 删除图片文件
   * 改进：使用OSS服务删除
   */
  static async deleteImageFile(localPath, thumbnailPath) {
    try {
      // 初始化OSS服务
      await ossService.initialize();
      
      // 从URL或路径中提取OSS key
      const extractOssKey = (url) => {
        if (!url) return null;
        
        // 如果是本地存储URL格式：/storage/uploads/generations/...
        if (url.startsWith('/storage/uploads/')) {
          return url.replace('/storage/uploads/', '');
        }
        
        // 如果是相对路径：/uploads/generations/...（兼容老数据）
        if (url.startsWith('/uploads/')) {
          return url.replace('/uploads/', '');
        }
        
        // 如果是HTTPS URL格式：https://ai.xingyuncl.com/storage/uploads/...
        if (url.includes('/storage/uploads/')) {
          const match = url.match(/\/storage\/uploads\/(.+)/);
          return match ? match[1] : null;
        }
        
        // 如果是OSS URL，尝试从URL中提取key
        if (url.startsWith('http://') || url.startsWith('https://')) {
          try {
            const urlObj = new URL(url);
            // 通常OSS URL格式：https://bucket.oss-region.aliyuncs.com/path/to/file
            const pathname = urlObj.pathname;
            // 移除开头的斜杠
            return pathname.startsWith('/') ? pathname.slice(1) : pathname;
          } catch (e) {
            logger.warn('无法解析URL提取OSS key', { url, error: e.message });
            return null;
          }
        }
        
        // 如果都不匹配，可能已经是OSS key了
        return url;
      };
      
      // 删除原图
      const ossKey = extractOssKey(localPath);
      if (ossKey) {
        await ossService.deleteFile(ossKey);
        logger.info('原图已删除', { ossKey });
      }
      
      // 删除缩略图
      const thumbOssKey = extractOssKey(thumbnailPath);
      if (thumbOssKey) {
        await ossService.deleteFile(thumbOssKey);
        logger.info('缩略图已删除', { thumbOssKey });
      }
      
    } catch (error) {
      logger.error('删除图片文件失败', { 
        localPath,
        thumbnailPath,
        error: error.message 
      });
      // 删除失败不抛出错误，避免影响主流程
    }
  }

  /**
   * 获取可用的图像模型列表
   */
  static async getAvailableModels() {
    try {
      return await ImageModel.findAll(true); // 只获取激活的模型
    } catch (error) {
      logger.error('获取可用模型失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取模型支持的尺寸
   */
  static async getModelSizes(modelId) {
    try {
      const model = await ImageModel.findById(modelId);
      if (!model) {
        throw new Error('模型不存在');
      }
      
      return model.sizes_supported || ['1024x1024'];
    } catch (error) {
      logger.error('获取模型尺寸失败', { modelId, error: error.message });
      throw error;
    }
  }

  /**
   * 验证生成参数
   */
  static validateGenerationParams(params) {
    const errors = [];
    
    // 验证prompt
    if (!params.prompt || params.prompt.trim().length === 0) {
      errors.push('提示词不能为空');
    } else if (params.prompt.length > 4000) {
      errors.push('提示词长度不能超过4000字符');
    }
    
    // 验证尺寸 - 支持更多格式
    if (params.size) {
      const validSizes = [
        '1024x1024', '864x1152', '1152x864', '1280x720',
        '720x1280', '832x1248', '1248x832', '1512x648',
        '2048x2048', '4K', '2K',  // Seedream系列支持的尺寸
        '1:1', '4:3', '3:4', '16:9', '9:16'  // 支持Midjourney的比例格式
      ];
      if (!validSizes.includes(params.size)) {
        errors.push('不支持的图片尺寸');
      }
    }
    
    // 验证seed
    if (params.seed !== undefined && params.seed !== null) {
      const seed = parseInt(params.seed);
      if (isNaN(seed) || seed < -1 || seed > 2147483647) {
        errors.push('种子值必须在-1到2147483647之间');
      }
    }
    
    // 验证guidance_scale
    if (params.guidance_scale !== undefined && params.guidance_scale !== null) {
      const scale = parseFloat(params.guidance_scale);
      if (isNaN(scale) || scale < 1 || scale > 10) {
        errors.push('引导系数必须在1到10之间');
      }
    }
    
    // 验证数量
    if (params.quantity !== undefined && params.quantity !== null) {
      const qty = parseInt(params.quantity);
      if (isNaN(qty) || qty < 1 || qty > 4) {
        errors.push('生成数量必须在1到4之间');
      }
    }
    
    // 验证参考图片URL
    if (params.reference_images && params.reference_images.length > 0) {
      for (const url of params.reference_images) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          errors.push('参考图片URL格式不正确');
          break;
        }
      }
    }
    
    return errors;
  }
}

module.exports = ImageService;
