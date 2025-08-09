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
   * 生成图片
   */
  static async generateImage(userId, modelId, params) {
    const startTime = Date.now();
    let generationId = null;
    
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

      // 检查积分是否充足
      const requiredCredits = model.price_per_image || 1;
      if (!user.hasCredits(requiredCredits)) {
        throw new Error(`积分不足，需要 ${requiredCredits} 积分`);
      }

      // 3. 创建生成记录
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
        credits_consumed: requiredCredits
      });

      // 4. 调用API生成图片
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

      logger.info('调用图像生成API', {
        userId,
        modelId,
        model: model.name,
        endpoint: model.endpoint
      });

      const response = await axios.post(
        model.endpoint,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 60000 // 60秒超时
        }
      );

      if (!response.data || !response.data.data || !response.data.data[0]) {
        throw new Error('API返回数据格式错误');
      }

      const imageUrl = response.data.data[0].url;
      
      // 5. 下载图片到本地
      const { localPath, thumbnailPath, fileSize } = await this.downloadAndSaveImage(
        imageUrl,
        generationId
      );

      // 6. 扣除用户积分
      // 注意：不传递modelId到credit_transactions，因为外键约束指向ai_models表
      // 使用image_consume作为交易类型以区分图像生成消费
      await user.consumeCredits(
        requiredCredits,
        null,  // 不传递modelId，因为credit_transactions.related_model_id外键指向ai_models表
        null,  // conversationId为null
        `图像生成 - ${model.display_name}`,  // reason描述
        'image_consume'  // 交易类型为image_consume
      );

      // 7. 更新生成记录
      const generationTime = Date.now() - startTime;
      await ImageGeneration.update(generationId, {
        image_url: imageUrl,
        local_path: localPath,
        thumbnail_path: thumbnailPath,
        file_size: fileSize,
        status: 'success',
        generation_time: generationTime
      });

      logger.info('图片生成成功', {
        userId,
        generationId,
        generationTime,
        creditsConsumed: requiredCredits
      });

      // 8. 返回生成结果
      return await ImageGeneration.findById(generationId);

    } catch (error) {
      logger.error('图片生成失败', {
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

      throw error;
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
      
      // 生成访问路径 - 修复路径生成逻辑
      // uploadDir是 /var/www/ai-platform/backend/uploads
      // 需要生成相对于uploads目录的路径
      const relativePath = path.relative(uploadBase, filePath);
      const relativeThumbPath = path.relative(uploadBase, thumbPath);
      
      // 确保路径以/开头，格式为 /uploads/generations/...
      const finalPath = '/uploads/' + relativePath.split(path.sep).join('/');
      const finalThumbPath = '/uploads/' + relativeThumbPath.split(path.sep).join('/');
      
      logger.info('图片保存成功', {
        filePath,
        thumbPath,
        finalPath,
        finalThumbPath
      });
      
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
    
    return errors;
  }
}

module.exports = ImageService;
