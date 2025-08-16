/**
 * Midjourney服务
 * 处理与Midjourney API的交互
 */

const axios = require('axios');
const crypto = require('crypto');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const User = require('../models/User');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const config = require('../config');

class MidjourneyService {
  /**
   * 生成标准的Midjourney按钮数据
   */
  static generateStandardButtons(taskId) {
    const baseId = taskId || crypto.randomBytes(8).toString('hex');
    return [
      { type: 'UPSCALE', label: 'U1', customId: `MJ::JOB::upsample::1::${baseId}` },
      { type: 'UPSCALE', label: 'U2', customId: `MJ::JOB::upsample::2::${baseId}` },
      { type: 'UPSCALE', label: 'U3', customId: `MJ::JOB::upsample::3::${baseId}` },
      { type: 'UPSCALE', label: 'U4', customId: `MJ::JOB::upsample::4::${baseId}` },
      { type: 'VARIATION', label: 'V1', customId: `MJ::JOB::variation::1::${baseId}` },
      { type: 'VARIATION', label: 'V2', customId: `MJ::JOB::variation::2::${baseId}` },
      { type: 'VARIATION', label: 'V3', customId: `MJ::JOB::variation::3::${baseId}` },
      { type: 'VARIATION', label: 'V4', customId: `MJ::JOB::variation::4::${baseId}` },
      { type: 'REROLL', label: '🔄', customId: `MJ::JOB::reroll::0::${baseId}`, emoji: '🔄' }
    ];
  }

  /**
   * 提交Imagine任务（文生图）
   */
  static async submitImagine(userId, modelId, params) {
    try {
      // 1. 获取模型配置
      const model = await ImageModel.findById(modelId);
      if (!model || !model.is_active) {
        throw new Error('模型不存在或未启用');
      }

      if (model.generation_type !== 'async' || model.provider !== 'midjourney') {
        throw new Error('该模型不是Midjourney模型');
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

      // 3. 解析API配置
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      if (!apiKey) {
        throw new Error('API密钥未配置');
      }

      const apiConfig = typeof model.api_config === 'string' 
        ? JSON.parse(model.api_config) 
        : model.api_config;

      // 4. 确定API端点（根据模式）
      const mode = params.mode || apiConfig.default_mode || 'fast';
      let endpoint = model.endpoint;
      
      // 替换端点中的模式占位符
      if (mode === 'turbo') {
        endpoint = endpoint.replace('/mj/', '/mj-turbo/');
      } else if (mode === 'relax') {
        endpoint = endpoint.replace('/mj/', '/mj-relax/');
      }

      // 5. 创建生成记录
      const generationId = await ImageGeneration.create({
        user_id: userId,
        model_id: modelId,
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        size: params.size || model.default_size || '1:1',
        status: 'generating',
        task_status: 'NOT_START',
        action_type: 'IMAGINE',
        generation_mode: mode,
        grid_layout: 1,  // Midjourney默认生成4宫格
        credits_consumed: requiredCredits
      });

      // 6. 构建请求数据
      const requestData = {
        prompt: params.prompt,
        base64Array: params.base64Array || [],
        notifyHook: params.notifyHook || model.webhook_url,
        state: JSON.stringify({
          userId,
          generationId,
          modelId
        })
      };

      logger.info('提交Midjourney Imagine任务', {
        userId,
        modelId,
        generationId,
        mode,
        prompt: params.prompt
      });

      // 7. 提交任务到Midjourney API
      const response = await axios.post(
        `${endpoint}/submit/imagine`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 30000
        }
      );

      // 8. 处理响应
      if (response.data.code === 1 && response.data.result) {
        const result = response.data.result;
        
        // 无论是字符串还是对象，都当作异步处理
        const taskId = typeof result === 'string' ? result : (result.taskId || result.id || String(Date.now()));
        
        // 更新生成记录，保存task_id
        await ImageGeneration.update(generationId, {
          task_id: taskId,
          task_status: 'SUBMITTED'
        });

        // 创建任务记录
        await this.createTaskRecord(userId, generationId, taskId, 'IMAGINE', mode);

        // 扣除积分
        await user.consumeCredits(
          requiredCredits,
          null,
          null,
          `Midjourney图像生成 - ${model.display_name}`,
          'image_consume'
        );

        // 开始轮询任务状态
        this.pollTaskStatus(taskId, generationId, model);

        return {
          success: true,
          taskId,
          generationId,
          creditsConsumed: requiredCredits,
          message: '任务已提交，正在生成中...'
        };
      }

      throw new Error('API响应格式错误');

    } catch (error) {
      logger.error('提交Midjourney Imagine任务失败', {
        userId,
        modelId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 提交Action任务（U/V操作）
   */
  static async submitAction(userId, parentGenerationId, action, index) {
    try {
      // 1. 获取父生成记录
      const parentGeneration = await ImageGeneration.findById(parentGenerationId);
      if (!parentGeneration) {
        throw new Error('原始生成记录不存在');
      }

      if (parentGeneration.user_id !== userId) {
        throw new Error('无权操作此记录');
      }

      if (!parentGeneration.buttons) {
        throw new Error('该图片不支持后续操作');
      }

      // 2. 解析buttons找到对应的customId
      const buttons = typeof parentGeneration.buttons === 'string' 
        ? JSON.parse(parentGeneration.buttons) 
        : parentGeneration.buttons;

      let customId = null;
      let actionLabel = '';

      if (action === 'UPSCALE') {
        const button = buttons.find(b => b.label === `U${index}`);
        if (!button) throw new Error(`不支持U${index}操作`);
        customId = button.customId;
        actionLabel = `放大第${index}张`;
      } else if (action === 'VARIATION') {
        const button = buttons.find(b => b.label === `V${index}`);
        if (!button) throw new Error(`不支持V${index}操作`);
        customId = button.customId;
        actionLabel = `变体第${index}张`;
      } else if (action === 'REROLL') {
        const button = buttons.find(b => b.emoji === '🔄');
        if (!button) throw new Error('不支持重新生成操作');
        customId = button.customId;
        actionLabel = '重新生成';
      }

      if (!customId) {
        throw new Error('无效的操作');
      }

      // 3. 获取模型配置
      const model = await ImageModel.findById(parentGeneration.model_id);
      if (!model) {
        throw new Error('模型不存在');
      }

      // 4. 检查用户积分
      const user = await User.findById(userId);
      const requiredCredits = parseFloat(model.price_per_image);
      
      if (!user.hasCredits(requiredCredits)) {
        throw new Error(`积分不足，需要 ${requiredCredits} 积分`);
      }

      // 5. 创建新的生成记录
      const generationId = await ImageGeneration.create({
        user_id: userId,
        model_id: parentGeneration.model_id,
        parent_id: parentGenerationId,
        prompt: parentGeneration.prompt,
        prompt_en: parentGeneration.prompt_en,
        size: parentGeneration.size,
        status: 'generating',
        task_status: 'NOT_START',
        action_type: action,
        action_index: index,
        generation_mode: parentGeneration.generation_mode,
        grid_layout: action === 'REROLL' ? 1 : 0,
        credits_consumed: requiredCredits
      });

      // 6. 提交Action请求
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      const endpoint = model.endpoint;

      const requestData = {
        customId,
        taskId: parentGeneration.task_id,
        notifyHook: model.webhook_url,
        state: JSON.stringify({
          userId,
          generationId,
          modelId: model.id,
          action,
          index
        })
      };

      logger.info('提交Midjourney Action任务', {
        userId,
        parentGenerationId,
        generationId,
        action,
        index,
        customId
      });

      const response = await axios.post(
        `${endpoint}/submit/action`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 30000
        }
      );

      if (response.data.code !== 1) {
        throw new Error(response.data.description || '操作提交失败');
      }

      const taskId = response.data.result;

      // 7. 更新生成记录
      await ImageGeneration.update(generationId, {
        task_id: taskId,
        task_status: 'SUBMITTED',
        mj_custom_id: customId
      });

      // 8. 创建任务记录
      await this.createTaskRecord(userId, generationId, taskId, action, parentGeneration.generation_mode);

      // 9. 扣除积分
      await user.consumeCredits(
        requiredCredits,
        null,
        null,
        `Midjourney ${actionLabel} - ${model.display_name}`,
        'image_consume'
      );

      // 10. 开始轮询任务状态
      this.pollTaskStatus(taskId, generationId, model);

      return {
        success: true,
        taskId,
        generationId,
        creditsConsumed: requiredCredits,
        message: `${actionLabel}任务已提交，正在处理中...`
      };

    } catch (error) {
      logger.error('提交Midjourney Action任务失败', {
        userId,
        parentGenerationId,
        action,
        index,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 查询任务状态
   */
  static async fetchTaskStatus(taskId, model) {
    try {
      const apiKey = ImageModel.decryptApiKey(model.api_key);
      const endpoint = model.endpoint;

      const response = await axios.get(
        `${endpoint}/task/${taskId}/fetch`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      logger.error('查询Midjourney任务状态失败', {
        taskId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 轮询任务状态
   */
  static async pollTaskStatus(taskId, generationId, model) {
    const pollingInterval = model.polling_interval || 2000;
    const maxPollingTime = model.max_polling_time || 300000;
    const startTime = Date.now();

    const poll = async () => {
      try {
        // 检查是否超时
        if (Date.now() - startTime > maxPollingTime) {
          await ImageGeneration.update(generationId, {
            status: 'failed',
            task_status: 'FAILURE',
            error_message: '任务超时',
            generation_time: Date.now() - startTime
          });
          return;
        }

        // 查询任务状态
        const taskData = await this.fetchTaskStatus(taskId, model);
        
        // 更新进度
        if (taskData.progress) {
          await ImageGeneration.update(generationId, {
            progress: taskData.progress,
            task_status: taskData.status
          });
        }

        // 判断任务是否完成
        if (taskData.status === 'SUCCESS') {
          // 下载并保存图片
          const imageService = require('./imageService');
          const { localPath, thumbnailPath, fileSize } = await imageService.downloadAndSaveImage(
            taskData.imageUrl,
            generationId
          );

          // 生成按钮数据（如果API没有返回）
          let buttons = null;
          if (taskData.buttons && taskData.buttons.length > 0) {
            buttons = taskData.buttons;
          } else {
            // API没有返回buttons，生成标准的U/V按钮
            buttons = this.generateStandardButtons(taskId);
          }

          // 更新生成记录
          await ImageGeneration.update(generationId, {
            image_url: taskData.imageUrl,
            local_path: localPath,
            thumbnail_path: thumbnailPath,
            file_size: fileSize,
            status: 'success',
            task_status: 'SUCCESS',
            task_id: taskId,  // 确保task_id被保存
            buttons: JSON.stringify(buttons),
            prompt_en: taskData.promptEn || taskData.prompt,
            generation_time: Date.now() - startTime,
            grid_layout: 1  // 确保grid_layout为1
          });

          // 更新任务记录
          await this.updateTaskRecord(taskId, 'SUCCESS', taskData);
          
          logger.info('Midjourney任务完成', {
            taskId,
            generationId,
            time: Date.now() - startTime
          });

        } else if (taskData.status === 'FAILURE') {
          // 任务失败
          await ImageGeneration.update(generationId, {
            status: 'failed',
            task_status: 'FAILURE',
            task_id: taskId,  // 即使失败也保存task_id
            error_message: taskData.failReason || '生成失败',
            fail_reason: taskData.failReason,
            generation_time: Date.now() - startTime
          });

          // 更新任务记录
          await this.updateTaskRecord(taskId, 'FAILURE', taskData);
          
          logger.error('Midjourney任务失败', {
            taskId,
            generationId,
            reason: taskData.failReason
          });

        } else {
          // 继续轮询
          setTimeout(() => poll(), pollingInterval);
        }
      } catch (error) {
        logger.error('轮询Midjourney任务状态出错', {
          taskId,
          generationId,
          error: error.message
        });
        
        // 重试
        setTimeout(() => poll(), pollingInterval * 2);
      }
    };

    // 开始轮询
    setTimeout(() => poll(), pollingInterval);
  }

  /**
   * 创建任务记录
   */
  static async createTaskRecord(userId, generationId, taskId, action, mode) {
    try {
      const query = `
        INSERT INTO midjourney_tasks 
        (user_id, generation_id, task_id, action, status, submit_time, properties)
        VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?)
      `;

      const properties = JSON.stringify({
        mode,
        action,
        timestamp: Date.now()
      });

      await dbConnection.query(query, [
        userId,
        generationId,
        taskId,
        action,
        Date.now(),
        properties
      ]);

    } catch (error) {
      logger.error('创建Midjourney任务记录失败', {
        userId,
        taskId,
        error: error.message
      });
    }
  }

  /**
   * 更新任务记录
   */
  static async updateTaskRecord(taskId, status, taskData) {
    try {
      const query = `
        UPDATE midjourney_tasks 
        SET status = ?, 
            finish_time = ?,
            properties = JSON_SET(properties, '$.result', ?)
        WHERE task_id = ?
      `;

      await dbConnection.query(query, [
        status,
        Date.now(),
        JSON.stringify(taskData),
        taskId
      ]);

    } catch (error) {
      logger.error('更新Midjourney任务记录失败', {
        taskId,
        error: error.message
      });
    }
  }

  /**
   * 处理Webhook回调
   */
  static async handleWebhook(data) {
    try {
      logger.info('收到Midjourney Webhook回调', data);
      
      // 解析state获取generationId
      const state = JSON.parse(data.state || '{}');
      const { generationId } = state;
      
      if (!generationId) {
        logger.warn('Webhook回调缺少generationId');
        return;
      }

      // 根据状态更新生成记录
      if (data.status === 'SUCCESS') {
        const imageService = require('./imageService');
        const { localPath, thumbnailPath, fileSize } = await imageService.downloadAndSaveImage(
          data.imageUrl,
          generationId
        );

        // 生成按钮数据
        let buttons = null;
        if (data.buttons && data.buttons.length > 0) {
          buttons = data.buttons;
        } else {
          buttons = this.generateStandardButtons(data.id || data.taskId);
        }

        await ImageGeneration.update(generationId, {
          image_url: data.imageUrl,
          local_path: localPath,
          thumbnail_path: thumbnailPath,
          file_size: fileSize,
          status: 'success',
          task_status: 'SUCCESS',
          task_id: data.id || data.taskId,
          buttons: JSON.stringify(buttons),
          prompt_en: data.promptEn,
          grid_layout: 1
        });
      } else if (data.status === 'FAILURE') {
        await ImageGeneration.update(generationId, {
          status: 'failed',
          task_status: 'FAILURE',
          error_message: data.failReason || '生成失败',
          fail_reason: data.failReason
        });
      } else {
        await ImageGeneration.update(generationId, {
          task_status: data.status,
          progress: data.progress
        });
      }

      return true;
    } catch (error) {
      logger.error('处理Midjourney Webhook失败', {
        error: error.message,
        data
      });
      return false;
    }
  }

  /**
   * 获取用户的Midjourney任务列表
   */
  static async getUserTasks(userId, options = {}) {
    try {
      const { page = 1, limit = 20, status = null } = options;
      const offset = (page - 1) * limit;

      let whereClause = 'user_id = ?';
      const params = [userId];

      if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
      }

      const countQuery = `
        SELECT COUNT(*) as total 
        FROM midjourney_tasks 
        WHERE ${whereClause}
      `;

      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      const query = `
        SELECT * FROM midjourney_tasks
        WHERE ${whereClause}
        ORDER BY submit_time DESC
        LIMIT ? OFFSET ?
      `;

      const result = await dbConnection.simpleQuery(query, [...params, limit, offset]);

      return {
        data: result.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户Midjourney任务列表失败', {
        userId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = MidjourneyService;
