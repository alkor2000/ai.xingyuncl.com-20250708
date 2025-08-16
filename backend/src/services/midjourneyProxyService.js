/**
 * Midjourney代理服务 - 处理同步的Midjourney API
 * 适用于goapi.gptnb.ai这类直接返回结果的API
 */

const axios = require('axios');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const User = require('../models/User');
const logger = require('../utils/logger');

class MidjourneyProxyService {
  /**
   * 同步生成Midjourney图片
   */
  static async generateSync(userId, modelId, params) {
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

      // Midjourney每次生成4张图，积分按4张计算
      const gridSize = model.api_config?.grid_size || 4;
      const requiredCredits = parseFloat(model.price_per_image) * gridSize;
      
      if (!user.hasCredits(requiredCredits)) {
        throw new Error(`积分不足，需要 ${requiredCredits} 积分`);
      }

      // 3. 创建生成记录
      generationId = await ImageGeneration.create({
        user_id: userId,
        model_id: modelId,
        prompt: params.prompt,
        negative_prompt: params.negative_prompt || '',
        size: params.size || model.default_size || '1:1',
        seed: params.seed || -1,
        guidance_scale: params.guidance_scale || 2.5,
        watermark: params.watermark !== false,
        status: 'generating',
        task_status: 'IN_PROGRESS',
        action_type: 'IMAGINE',
        generation_mode: params.mode || 'fast',
        grid_layout: 1, // 标记为4图网格
        credits_consumed: requiredCredits
      });

      // 4. 解析API密钥
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      if (!apiKey) {
        throw new Error('API密钥未配置');
      }

      // 5. 构建请求数据
      const requestData = {
        prompt: params.prompt,
        action: 'IMAGINE',
        index: 0
      };

      // 如果有比例参数，添加到prompt中
      if (params.size && params.size !== '1:1') {
        requestData.prompt += ` --ar ${params.size}`;
      }

      logger.info('调用Midjourney代理API', {
        userId,
        modelId,
        generationId,
        prompt: requestData.prompt
      });

      // 6. 调用API
      const response = await axios.post(
        model.endpoint,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 300000 // 5分钟超时
        }
      );

      // 7. 处理响应
      if (!response.data || response.data.code !== 1) {
        throw new Error(response.data?.msg || 'API调用失败');
      }

      const resultData = response.data.data;
      const imageUrl = resultData.imageUrl || resultData.image_url || resultData.url;
      
      if (!imageUrl) {
        throw new Error('API未返回图片URL');
      }

      // 8. 下载并保存图片
      const imageService = require('./imageService');
      const { localPath, thumbnailPath, fileSize } = await imageService.downloadAndSaveImage(
        imageUrl,
        generationId
      );

      // 9. 构建按钮数据（用于U/V操作）
      const buttons = this.generateButtons(resultData.task_id || `proxy_${generationId}`);

      // 10. 更新生成记录
      const generationTime = Date.now() - startTime;
      await ImageGeneration.update(generationId, {
        task_id: resultData.task_id || `proxy_${generationId}`,
        image_url: imageUrl,
        local_path: localPath,
        thumbnail_path: thumbnailPath,
        file_size: fileSize,
        status: 'success',
        task_status: 'SUCCESS',
        generation_time: generationTime,
        buttons: JSON.stringify(buttons),
        prompt_en: resultData.prompt_en || params.prompt
      });

      // 11. 扣除积分
      await user.consumeCredits(
        requiredCredits,
        null,
        null,
        `Midjourney图像生成 - ${model.display_name}`,
        'image_consume'
      );

      const result = await ImageGeneration.findById(generationId);
      
      logger.info('Midjourney代理生成成功', {
        userId,
        generationId,
        time: generationTime
      });

      return result;

    } catch (error) {
      logger.error('Midjourney代理生成失败', {
        userId,
        modelId,
        generationId,
        error: error.message
      });

      // 更新失败状态
      if (generationId) {
        await ImageGeneration.update(generationId, {
          status: 'failed',
          task_status: 'FAILURE',
          error_message: error.message,
          generation_time: Date.now() - startTime
        });
      }

      throw error;
    }
  }

  /**
   * 生成操作按钮数据
   */
  static generateButtons(taskId) {
    const buttons = [];
    
    // U按钮（放大）
    for (let i = 1; i <= 4; i++) {
      buttons.push({
        type: 'UPSCALE',
        label: `U${i}`,
        customId: `MJ::JOB::upsample::${i}::${taskId}`,
        emoji: '🔍'
      });
    }
    
    // V按钮（变体）
    for (let i = 1; i <= 4; i++) {
      buttons.push({
        type: 'VARIATION',
        label: `V${i}`,
        customId: `MJ::JOB::variation::${i}::${taskId}`,
        emoji: '🎨'
      });
    }
    
    // 重新生成按钮
    buttons.push({
      type: 'REROLL',
      label: '🔄',
      customId: `MJ::JOB::reroll::0::${taskId}`,
      emoji: '🔄'
    });
    
    return buttons;
  }

  /**
   * 处理U/V操作
   */
  static async handleAction(userId, parentGenerationId, action, index) {
    const startTime = Date.now();
    let generationId = null;
    
    try {
      // 1. 获取父记录
      const parentGeneration = await ImageGeneration.findById(parentGenerationId);
      if (!parentGeneration) {
        throw new Error('原始生成记录不存在');
      }

      if (parentGeneration.user_id !== userId) {
        throw new Error('无权操作此记录');
      }

      // 2. 获取模型和用户
      const model = await ImageModel.findById(parentGeneration.model_id);
      const user = await User.findById(userId);
      
      const requiredCredits = parseFloat(model.price_per_image);
      
      if (!user.hasCredits(requiredCredits)) {
        throw new Error(`积分不足，需要 ${requiredCredits} 积分`);
      }

      // 3. 创建新记录
      generationId = await ImageGeneration.create({
        user_id: userId,
        model_id: parentGeneration.model_id,
        parent_id: parentGenerationId,
        prompt: parentGeneration.prompt,
        prompt_en: parentGeneration.prompt_en,
        size: parentGeneration.size,
        status: 'generating',
        task_status: 'IN_PROGRESS',
        action_type: action,
        action_index: index,
        generation_mode: parentGeneration.generation_mode,
        grid_layout: action === 'REROLL' ? 1 : 0,
        credits_consumed: requiredCredits
      });

      // 4. 调用API
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      
      const requestData = {
        action: action === 'UPSCALE' ? 'UPSCALE' : action === 'VARIATION' ? 'VARIATION' : 'REROLL',
        index: index || 1,
        taskId: parentGeneration.task_id,
        prompt: parentGeneration.prompt
      };

      logger.info('调用Midjourney代理Action', {
        userId,
        parentGenerationId,
        generationId,
        action,
        index
      });

      const response = await axios.post(
        model.endpoint,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 300000
        }
      );

      if (!response.data || response.data.code !== 1) {
        throw new Error(response.data?.msg || 'Action失败');
      }

      const resultData = response.data.data;
      const imageUrl = resultData.imageUrl || resultData.image_url || resultData.url;

      // 5. 下载并保存图片
      const imageService = require('./imageService');
      const { localPath, thumbnailPath, fileSize } = await imageService.downloadAndSaveImage(
        imageUrl,
        generationId
      );

      // 6. 更新记录
      await ImageGeneration.update(generationId, {
        task_id: resultData.task_id || `proxy_action_${generationId}`,
        image_url: imageUrl,
        local_path: localPath,
        thumbnail_path: thumbnailPath,
        file_size: fileSize,
        status: 'success',
        task_status: 'SUCCESS',
        generation_time: Date.now() - startTime,
        buttons: action === 'REROLL' ? JSON.stringify(this.generateButtons(resultData.task_id || `proxy_${generationId}`)) : null
      });

      // 7. 扣除积分
      const actionLabel = action === 'UPSCALE' ? `放大第${index}张` : action === 'VARIATION' ? `变体第${index}张` : '重新生成';
      await user.consumeCredits(
        requiredCredits,
        null,
        null,
        `Midjourney ${actionLabel} - ${model.display_name}`,
        'image_consume'
      );

      const result = await ImageGeneration.findById(generationId);
      
      return {
        success: true,
        data: result,
        message: `${actionLabel}成功`
      };

    } catch (error) {
      logger.error('Midjourney代理Action失败', {
        userId,
        parentGenerationId,
        action,
        index,
        error: error.message
      });

      if (generationId) {
        await ImageGeneration.update(generationId, {
          status: 'failed',
          task_status: 'FAILURE',
          error_message: error.message,
          generation_time: Date.now() - startTime
        });
      }

      throw error;
    }
  }
}

module.exports = MidjourneyProxyService;
