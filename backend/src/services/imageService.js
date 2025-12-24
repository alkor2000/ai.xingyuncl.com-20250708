/**
 * 图像生成服务
 * 处理与火山方舟API、阿里通义万相API的交互
 * 
 * 更新记录：
 * - 2025-12-24: 修复万相SSE响应解析 - 收集所有数据块中的图片
 */

const axios = require('axios');
const crypto = require('crypto');
const sharp = require('sharp');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const User = require('../models/User');
const ossService = require('./ossService');
const logger = require('../utils/logger');

class ImageService {
  // 判断是否为Seedream系列模型
  static isSeedreamModel(model) {
    if (!model || !model.model_id) return false;
    return model.provider === 'volcano' && model.model_id.startsWith('doubao-seedream');
  }

  // 判断是否为阿里通义万相模型
  static isWanxiangModel(model) {
    if (!model || !model.model_id) return false;
    return model.provider === 'aliyun' || 
           model.provider === 'dashscope' ||
           model.model_id.startsWith('wan') ||
           model.model_id.startsWith('wanx');
  }

  // 获取Seedream模型版本号
  static getSeedreamVersion(modelId) {
    if (!modelId) return '4.0';
    const match = modelId.match(/doubao-seedream-(\d+)-(\d+)/);
    return match ? `${match[1]}.${match[2]}` : '4.0';
  }

  // 将标准尺寸转换为Seedream API格式
  static convertSizeForSeedream(size) {
    const sizeMapping = {
      '1024x1024': '2K', '2048x2048': '4K', '864x1152': '2K',
      '1152x864': '2K', '1280x720': '2K', '720x1280': '2K',
      '2K': '2K', '4K': '4K',
      '1:1': '2K', '4:3': '2K', '3:4': '2K', '16:9': '2K', '9:16': '2K'
    };
    return sizeMapping[size] || '2K';
  }

  // 将标准尺寸转换为通义万相API格式
  static convertSizeForWanxiang(size) {
    if (!size) return '1280*1280';
    if (size.includes('*')) return size;
    if (size.includes('x')) return size.replace('x', '*');
    const ratioMapping = {
      '1:1': '1280*1280', '4:3': '1280*960', '3:4': '960*1280',
      '16:9': '1280*720', '9:16': '720*1280'
    };
    return ratioMapping[size] || '1280*1280';
  }

  /**
   * 构建通义万相API请求体
   */
  static buildWanxiangRequest(model, params) {
    const hasReferenceImages = params.reference_images && params.reference_images.length > 0;
    const content = [{ text: params.prompt }];
    
    if (hasReferenceImages) {
      for (const imageUrl of params.reference_images) {
        content.push({ image: imageUrl });
      }
    }
    
    return {
      model: model.model_id,
      input: {
        messages: [{ role: 'user', content: content }]
      },
      parameters: {
        size: this.convertSizeForWanxiang(params.size),
        n: 1,
        stream: true,
        enable_interleave: !hasReferenceImages
      }
    };
  }

  /**
   * 调用万相API（SSE流式输出）
   * 关键修复：收集所有数据块中的图片URL，而不是只取最后一个
   */
  static async callWanxiangAPI(endpoint, requestData, apiKey) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const url = new URL(endpoint);
      
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-DashScope-SSE': 'enable'
        }
      };
      
      logger.info('万相API SSE请求', {
        endpoint, model: requestData.model,
        stream: requestData.parameters.stream,
        enableInterleave: requestData.parameters.enable_interleave
      });
      
      const req = https.request(options, (res) => {
        let buffer = '';
        let collectedImages = [];  // 收集所有图片URL
        let lastData = null;
        let errorData = null;
        
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (dataStr && dataStr !== '[DONE]') {
                try {
                  const parsed = JSON.parse(dataStr);
                  
                  // 检查错误
                  if (parsed.code) {
                    errorData = parsed;
                    continue;
                  }
                  
                  lastData = parsed;
                  
                  // 关键：从每个数据块中提取图片URL
                  if (parsed.output?.choices?.[0]?.message?.content) {
                    for (const item of parsed.output.choices[0].message.content) {
                      if (item.image) {
                        collectedImages.push(item.image);
                        logger.info('SSE收集到图片', { imageUrl: item.image.substring(0, 100) });
                      }
                    }
                  }
                } catch (e) {
                  // 忽略解析错误
                }
              }
            }
          }
        });
        
        res.on('end', () => {
          // 处理剩余buffer
          if (buffer) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.code) {
                      errorData = parsed;
                    } else {
                      lastData = parsed;
                      // 提取图片
                      if (parsed.output?.choices?.[0]?.message?.content) {
                        for (const item of parsed.output.choices[0].message.content) {
                          if (item.image) {
                            collectedImages.push(item.image);
                          }
                        }
                      }
                    }
                  } catch (e) {}
                }
              }
            }
          }
          
          if (errorData) {
            logger.error('万相API返回错误', { errorData });
            reject(new Error(errorData.message || `万相API错误: ${errorData.code}`));
            return;
          }
          
          if (res.statusCode !== 200) {
            logger.error('万相API HTTP错误', { statusCode: res.statusCode, lastData });
            reject(new Error(lastData?.message || `API返回错误: ${res.statusCode}`));
            return;
          }
          
          logger.info('万相SSE响应完成', {
            collectedImagesCount: collectedImages.length,
            hasLastData: !!lastData
          });
          
          // 构造最终响应，将收集到的图片放入content
          if (collectedImages.length > 0 && lastData) {
            // 用收集到的图片覆盖lastData中的content
            if (lastData.output?.choices?.[0]?.message) {
              lastData.output.choices[0].message.content = 
                collectedImages.map(img => ({ type: 'image', image: img }));
            }
          }
          
          if (!lastData) {
            reject(new Error('万相API未返回有效数据'));
            return;
          }
          
          resolve({ data: lastData });
        });
        
        res.on('error', reject);
      });
      
      req.on('error', reject);
      req.setTimeout(120000, () => {
        req.destroy();
        reject(new Error('万相API请求超时'));
      });
      
      req.write(JSON.stringify(requestData));
      req.end();
    });
  }

  /**
   * 解析通义万相API响应
   */
  static parseWanxiangResponse(response) {
    if (!response.data) throw new Error('万相API响应为空');
    if (response.data.code) throw new Error(response.data.message || `万相API错误: ${response.data.code}`);
    
    const output = response.data.output;
    if (!output?.choices?.[0]) {
      logger.error('万相API响应格式错误', { responseData: response.data });
      throw new Error('万相API响应格式错误：缺少choices');
    }
    
    const content = output.choices[0].message?.content;
    if (!content || content.length === 0) {
      logger.error('万相API响应内容为空', { choice: output.choices[0] });
      throw new Error('万相API响应格式错误：缺少content');
    }
    
    // 查找图片
    for (const item of content) {
      if (item.image) return item.image;
    }
    
    throw new Error('万相API未返回图片URL');
  }

  /**
   * 批量生成图片
   */
  static async generateImages(userId, modelId, params, quantity = 1) {
    const actualQuantity = Math.min(Math.max(1, quantity), 4);
    
    try {
      const model = await ImageModel.findById(modelId);
      if (!model || !model.is_active) throw new Error('模型不存在或未启用');

      const user = await User.findById(userId);
      if (!user) throw new Error('用户不存在');

      const isMidjourney = model.provider === 'midjourney';
      let effectiveQuantity = actualQuantity;
      let pricePerImage = parseFloat(model.price_per_image) || 1;
      
      if (isMidjourney) {
        effectiveQuantity = 1;
        pricePerImage = pricePerImage * (model.api_config?.grid_size || 4);
      }

      const requiredCredits = pricePerImage * effectiveQuantity;
      if (!user.hasCredits(requiredCredits)) throw new Error(`积分不足，需要 ${requiredCredits} 积分`);

      logger.info('开始批量生成图片', {
        userId, modelId, quantity: effectiveQuantity, requiredCredits,
        isWanxiang: this.isWanxiangModel(model),
        hasReferenceImages: params.reference_images?.length > 0
      });

      const generatePromises = [];
      for (let i = 0; i < effectiveQuantity; i++) {
        const seed = params.seed === -1 || params.seed === undefined ? -1 : (params.seed + i);
        generatePromises.push(this.generateSingleImage(userId, modelId, { ...params, seed }, model, i + 1));
      }

      const results = await Promise.allSettled(generatePromises);
      const successResults = [], failedResults = [];
      let totalConsumedCredits = 0;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successResults.push(result.value.data);
          totalConsumedCredits += pricePerImage;
        } else {
          failedResults.push({ index: index + 1, error: result.reason?.message || result.value?.error || '生成失败' });
        }
      });

      if (successResults.length > 0) {
        const displayName = isMidjourney 
          ? `Midjourney图像生成 - ${model.display_name}`
          : params.reference_images?.length > 0
          ? `图生图 - ${model.display_name} × ${successResults.length}张`
          : `图像生成 - ${model.display_name} × ${successResults.length}张`;
        await user.consumeCredits(totalConsumedCredits, null, null, displayName, 'image_consume');
      }

      logger.info('批量生成完成', { userId, succeeded: successResults.length, failed: failedResults.length, creditsConsumed: totalConsumedCredits });

      return { success: true, requested: effectiveQuantity, succeeded: successResults.length, failed: failedResults.length, creditsConsumed: totalConsumedCredits, results: successResults, errors: failedResults };
    } catch (error) {
      logger.error('批量生成图片失败', { userId, modelId, error: error.message });
      throw error;
    }
  }

  /**
   * 生成单张图片
   */
  static async generateSingleImage(userId, modelId, params, model, index = 1) {
    const startTime = Date.now();
    let generationId = null;
    
    try {
      const isMidjourney = model.provider === 'midjourney';
      const isSeedream = this.isSeedreamModel(model);
      const isWanxiang = this.isWanxiangModel(model);
      
      const creditsToConsume = isMidjourney 
        ? parseFloat(model.price_per_image) * (model.api_config?.grid_size || 4)
        : parseFloat(model.price_per_image) || 1;
      
      const generationData = {
        user_id: userId, model_id: modelId, prompt: params.prompt,
        negative_prompt: params.negative_prompt || '',
        size: params.size || model.default_size,
        seed: params.seed || -1,
        guidance_scale: params.guidance_scale || model.default_guidance_scale,
        watermark: params.watermark !== false,
        status: 'generating', credits_consumed: creditsToConsume
      };
      
      if (params.reference_images?.length > 0) {
        generationData.reference_images = JSON.stringify(params.reference_images);
      }
      if (isMidjourney) {
        generationData.action_type = 'IMAGINE';
        generationData.generation_mode = params.mode || 'fast';
        generationData.grid_layout = 1;
      }
      
      generationId = await ImageGeneration.create(generationData);

      const apiKey = ImageModel.decryptApiKey(model.api_key);
      if (!apiKey) throw new Error('API密钥未配置');

      let requestData, response;
      const requestUrl = model.endpoint;
      
      if (isMidjourney) {
        requestData = { prompt: params.prompt, action: 'IMAGINE', index: 0 };
        if (params.size && params.size !== '1:1') requestData.prompt += ` --ar ${params.size}`;
        response = await axios.post(requestUrl, requestData, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          timeout: 300000
        });
      } else if (isWanxiang) {
        requestData = this.buildWanxiangRequest(model, params);
        logger.info('通义万相API请求', {
          modelId: model.model_id, hasReferenceImages: params.reference_images?.length > 0,
          size: requestData.parameters.size, stream: requestData.parameters.stream,
          enableInterleave: requestData.parameters.enable_interleave
        });
        response = await this.callWanxiangAPI(requestUrl, requestData, apiKey);
      } else if (isSeedream) {
        requestData = { model: model.model_id, prompt: params.prompt };
        if (params.reference_images?.length > 0) requestData.image = params.reference_images;
        requestData.size = this.convertSizeForSeedream(params.size);
        requestData.response_format = 'url';
        requestData.stream = false;
        requestData.watermark = params.watermark !== false;
        if (params.guidance_scale) requestData.cfg_scale = params.guidance_scale;
        if (params.seed && params.seed !== -1) requestData.seed = params.seed;
        response = await axios.post(requestUrl, requestData, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          timeout: 60000
        });
      } else {
        requestData = {
          model: model.model_id, prompt: params.prompt, response_format: 'url',
          size: params.size || model.default_size, seed: params.seed || -1,
          guidance_scale: params.guidance_scale || model.default_guidance_scale,
          watermark: params.watermark !== false
        };
        if (params.negative_prompt) requestData.negative_prompt = params.negative_prompt;
        response = await axios.post(requestUrl, requestData, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          timeout: 60000
        });
      }

      logger.info(`生成第${index}张图片`, { userId, modelId, generationId, isWanxiang, provider: model.provider });

      let imageUrl;
      if (isMidjourney) {
        if (!response.data || response.data.code !== 1) throw new Error(response.data?.msg || 'Midjourney API调用失败');
        imageUrl = response.data.data?.imageUrl || response.data.data?.image_url || response.data.data?.url;
        if (!imageUrl) throw new Error('Midjourney API未返回图片URL');
      } else if (isWanxiang) {
        logger.info('通义万相API响应', { hasOutput: !!response.data?.output, responsePreview: JSON.stringify(response.data).substring(0, 500) });
        imageUrl = this.parseWanxiangResponse(response);
      } else {
        if (!response.data?.data?.[0]) throw new Error('API返回数据格式错误');
        imageUrl = response.data.data[0].url;
      }
      
      const { localPath, thumbnailPath, fileSize } = await this.downloadAndSaveImage(imageUrl, generationId, userId);

      const updateData = {
        image_url: imageUrl, local_path: localPath, thumbnail_path: thumbnailPath,
        file_size: fileSize, status: 'success', generation_time: Date.now() - startTime
      };
      
      if (isMidjourney) {
        updateData.task_status = 'SUCCESS';
        updateData.task_id = response.data?.data?.task_id || `mj_${generationId}`;
        updateData.buttons = JSON.stringify([
          { type: 'UPSCALE', label: 'U1', customId: 'U1' }, { type: 'UPSCALE', label: 'U2', customId: 'U2' },
          { type: 'UPSCALE', label: 'U3', customId: 'U3' }, { type: 'UPSCALE', label: 'U4', customId: 'U4' },
          { type: 'VARIATION', label: 'V1', customId: 'V1' }, { type: 'VARIATION', label: 'V2', customId: 'V2' },
          { type: 'VARIATION', label: 'V3', customId: 'V3' }, { type: 'VARIATION', label: 'V4', customId: 'V4' },
          { type: 'REROLL', label: '🔄', customId: 'REROLL' }
        ]);
      }
      
      await ImageGeneration.update(generationId, updateData);
      const result = await ImageGeneration.findById(generationId);
      return { success: true, data: result };

    } catch (error) {
      logger.error(`生成第${index}张图片失败`, { userId, modelId, generationId, error: error.message });
      if (generationId) {
        await ImageGeneration.update(generationId, {
          status: 'failed', error_message: error.message, generation_time: Date.now() - startTime,
          ...(model.provider === 'midjourney' ? { task_status: 'FAILURE' } : {})
        });
      }
      return { success: false, error: error.message };
    }
  }

  // 生成图片（兼容方法）
  static async generateImage(userId, modelId, params) {
    const result = await this.generateImages(userId, modelId, params, 1);
    if (result.succeeded > 0) return result.results[0];
    throw new Error(result.errors[0]?.error || '生成失败');
  }

  // 下载并保存图片
  static async downloadAndSaveImage(imageUrl, generationId, userId) {
    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const imageBuffer = Buffer.from(response.data);
      await ossService.initialize();
      
      const dateFolder = new Date().toISOString().slice(0, 7);
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const fileName = `gen_${generationId}_${timestamp}_${random}.jpg`;
      const thumbFileName = `thumb_${generationId}_${timestamp}_${random}.jpg`;
      const ossKey = `generations/${userId}/${dateFolder}/${fileName}`;
      const thumbOssKey = `generations/${userId}/${dateFolder}/${thumbFileName}`;
      
      const thumbnailBuffer = await sharp(imageBuffer).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      
      const uploadResult = await ossService.uploadFile(imageBuffer, ossKey, { headers: { 'Content-Type': 'image/jpeg' } });
      const thumbResult = await ossService.uploadFile(thumbnailBuffer, thumbOssKey, { headers: { 'Content-Type': 'image/jpeg' } });
      
      logger.info('图片已保存', { generationId, userId, ossKey });
      return { localPath: uploadResult.url, thumbnailPath: thumbResult.url, fileSize: imageBuffer.length };
    } catch (error) {
      logger.error('下载保存图片失败', { imageUrl, generationId, userId, error: error.message });
      throw new Error('保存图片失败: ' + error.message);
    }
  }

  // 删除图片文件
  static async deleteImageFile(localPath, thumbnailPath) {
    try {
      await ossService.initialize();
      const extractOssKey = (url) => {
        if (!url) return null;
        if (url.startsWith('/storage/uploads/')) return url.replace('/storage/uploads/', '');
        if (url.startsWith('/uploads/')) return url.replace('/uploads/', '');
        if (url.includes('/storage/uploads/')) { const m = url.match(/\/storage\/uploads\/(.+)/); return m ? m[1] : null; }
        if (url.startsWith('http')) { try { return new URL(url).pathname.replace(/^\//, ''); } catch { return null; } }
        return url;
      };
      const ossKey = extractOssKey(localPath);
      if (ossKey) await ossService.deleteFile(ossKey);
      const thumbOssKey = extractOssKey(thumbnailPath);
      if (thumbOssKey) await ossService.deleteFile(thumbOssKey);
    } catch (error) {
      logger.error('删除图片文件失败', { error: error.message });
    }
  }

  // 获取可用的图像模型列表
  static async getAvailableModels() {
    return await ImageModel.findAll(true);
  }

  // 获取模型支持的尺寸
  static async getModelSizes(modelId) {
    const model = await ImageModel.findById(modelId);
    if (!model) throw new Error('模型不存在');
    return model.sizes_supported || ['1024x1024'];
  }

  // 验证生成参数
  static validateGenerationParams(params) {
    const errors = [];
    if (!params.prompt?.trim()) errors.push('提示词不能为空');
    else if (params.prompt.length > 4000) errors.push('提示词长度不能超过4000字符');
    if (params.seed !== undefined && params.seed !== null) {
      const seed = parseInt(params.seed);
      if (isNaN(seed) || seed < -1 || seed > 2147483647) errors.push('种子值必须在-1到2147483647之间');
    }
    if (params.quantity !== undefined) {
      const qty = parseInt(params.quantity);
      if (isNaN(qty) || qty < 1 || qty > 4) errors.push('生成数量必须在1到4之间');
    }
    if (params.reference_images?.length > 0) {
      for (const url of params.reference_images) {
        if (!url.startsWith('http')) { errors.push('参考图片URL格式不正确'); break; }
      }
    }
    return errors;
  }
}

module.exports = ImageService;
