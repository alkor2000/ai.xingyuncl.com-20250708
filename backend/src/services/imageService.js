/**
 * 图像生成服务
 * 处理与火山方舟API的交互
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const User = require('../models/User');
const logger = require('../utils/logger');
const config = require('../config');

class ImageService {
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

      // 检查积分是否充足（单价 × 数量）- 确保类型转换
      const pricePerImage = parseFloat(model.price_per_image) || 1;
      const requiredCredits = pricePerImage * actualQuantity;
      
      if (!user.hasCredits(requiredCredits)) {
        throw new Error(`积分不足，需要 ${requiredCredits} 积分`);
      }

      logger.info('开始批量生成图片', {
        userId,
        modelId,
        quantity: actualQuantity,
        pricePerImage,
        requiredCredits
      });

      // 3. 并发生成多张图片
      const generatePromises = [];
      for (let i = 0; i < actualQuantity; i++) {
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
      let totalConsumedCredits = 0; // 确保初始化为数字0

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successResults.push(result.value.data);
          // 确保积分累加使用数字类型
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
        await user.consumeCredits(
          totalConsumedCredits,
          null,
          null,
          `批量图像生成 - ${model.display_name} × ${successResults.length}张`,
          'image_consume'
        );
      }

      logger.info('批量生成完成', {
        userId,
        requested: actualQuantity,
        succeeded: successResults.length,
        failed: failedResults.length,
        creditsConsumed: totalConsumedCredits
      });

      return {
        success: true,
        requested: actualQuantity,
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
      // 1. 创建生成记录 - 确保credits_consumed是数字
      const creditsToConsume = parseFloat(model.price_per_image) || 1;
      
      generationId = await ImageGeneration.create({
        user_id: userId,
        model_id: modelId,
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        size: params.size || model.default_size,
        seed: params.seed || -1,
        guidance_scale: params.guidance_scale || model.default_guidance_scale,
        watermark: params.watermark !== false,
        status: 'generating',
        credits_consumed: creditsToConsume
      });

      // 2. 调用API生成图片
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      if (!apiKey) {
        throw new Error('API密钥未配置');
      }

      const requestData = {
        model: model.model_id,
        prompt: params.prompt,
        response_format: 'url',
        size: params.size || model.default_size,
        seed: params.seed || -1,
        guidance_scale: params.guidance_scale || model.default_guidance_scale,
        watermark: params.watermark !== false
      };

      logger.info(`生成第${index}张图片`, {
        userId,
        modelId,
        generationId,
        creditsToConsume
      });

      const response = await axios.post(
        model.endpoint,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 60000
        }
      );

      if (!response.data || !response.data.data || !response.data.data[0]) {
        throw new Error('API返回数据格式错误');
      }

      const imageUrl = response.data.data[0].url;
      
      // 3. 下载图片到本地
      const { localPath, thumbnailPath, fileSize } = await this.downloadAndSaveImage(
        imageUrl,
        generationId
      );

      // 4. 更新生成记录
      const generationTime = Date.now() - startTime;
      await ImageGeneration.update(generationId, {
        image_url: imageUrl,
        local_path: localPath,
        thumbnail_path: thumbnailPath,
        file_size: fileSize,
        status: 'success',
        generation_time: generationTime
      });

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
        error: error.message
      });

      // 更新失败状态
      if (generationId) {
        await ImageGeneration.update(generationId, {
          status: 'failed',
          error_message: error.message,
          generation_time: Date.now() - startTime
        });
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
   */
  static async downloadAndSaveImage(imageUrl, generationId) {
    try {
      // 下载图片
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const imageBuffer = Buffer.from(response.data);
      
      // 生成文件路径
      const uploadBase = config.upload.uploadDir;
      const dateFolder = new Date().toISOString().slice(0, 7); // YYYY-MM
      const saveDir = path.join(uploadBase, 'generations', dateFolder);
      
      // 确保目录存在
      await fs.mkdir(saveDir, { recursive: true });
      
      // 生成文件名
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const fileName = `gen_${generationId}_${timestamp}_${random}.jpg`;
      const thumbFileName = `thumb_${generationId}_${timestamp}_${random}.jpg`;
      
      const filePath = path.join(saveDir, fileName);
      const thumbPath = path.join(saveDir, thumbFileName);
      
      // 保存原图
      await fs.writeFile(filePath, imageBuffer);
      
      // 生成缩略图
      await sharp(imageBuffer)
        .resize(400, 400, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 85 })
        .toFile(thumbPath);
      
      // 获取文件大小
      const stats = await fs.stat(filePath);
      
      // 生成访问路径
      const relativePath = path.relative(uploadBase, filePath);
      const relativeThumbPath = path.relative(uploadBase, thumbPath);
      
      // 确保路径以/开头，格式为 /uploads/generations/...
      const finalPath = '/uploads/' + relativePath.split(path.sep).join('/');
      const finalThumbPath = '/uploads/' + relativeThumbPath.split(path.sep).join('/');
      
      return {
        localPath: finalPath,
        thumbnailPath: finalThumbPath,
        fileSize: stats.size
      };
      
    } catch (error) {
      logger.error('下载保存图片失败', {
        imageUrl,
        generationId,
        error: error.message
      });
      throw new Error('保存图片失败: ' + error.message);
    }
  }

  /**
   * 删除图片文件
   */
  static async deleteImageFile(localPath, thumbnailPath) {
    try {
      const uploadBase = config.upload.uploadDir;
      
      if (localPath) {
        // 移除/uploads/前缀，拼接完整路径
        const relativePath = localPath.replace(/^\/uploads\//, '');
        const fullPath = path.join(uploadBase, relativePath);
        try {
          await fs.unlink(fullPath);
        } catch (e) {
          logger.warn('删除原图失败', { path: fullPath, error: e.message });
        }
      }
      
      if (thumbnailPath) {
        // 移除/uploads/前缀，拼接完整路径
        const relativePath = thumbnailPath.replace(/^\/uploads\//, '');
        const fullThumbPath = path.join(uploadBase, relativePath);
        try {
          await fs.unlink(fullThumbPath);
        } catch (e) {
          logger.warn('删除缩略图失败', { path: fullThumbPath, error: e.message });
        }
      }
    } catch (error) {
      logger.error('删除图片文件失败', { error: error.message });
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
    } else if (params.prompt.length > 1000) {
      errors.push('提示词长度不能超过1000字符');
    }
    
    // 验证尺寸
    if (params.size) {
      const validSizes = [
        '1024x1024', '864x1152', '1152x864', '1280x720',
        '720x1280', '832x1248', '1248x832', '1512x648'
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
    
    return errors;
  }
}

module.exports = ImageService;
