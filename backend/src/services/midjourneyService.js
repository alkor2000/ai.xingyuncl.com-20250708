/**
 * Midjourney服务
 * 处理与Midjourney API的交互
 */

const axios = require('axios');
const safety = require('./imageSafetyService');
const crypto = require('crypto');
const ImageModel = require('../models/ImageModel');
const ImageGeneration = require('../models/ImageGeneration');
const User = require('../models/User');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const config = require('../config');

class MidjourneyService {
  /**
   * 映射API状态到数据库ENUM值
   */
  static mapTaskStatus(apiStatus) {
    if (!apiStatus) return 'NOT_START';
    
    const statusMap = {
      'NOT_START': 'NOT_START',
      'SUBMITTED': 'SUBMITTED',
      'IN_PROGRESS': 'IN_PROGRESS',
      'SUCCESS': 'SUCCESS',
      'FAILURE': 'FAILURE',
      // 处理可能的变体
      'not_start': 'NOT_START',
      'submitted': 'SUBMITTED',
      'in_progress': 'IN_PROGRESS',
      'success': 'SUCCESS',
      'failure': 'FAILURE',
      'failed': 'FAILURE',
      'pending': 'SUBMITTED',
      'processing': 'IN_PROGRESS',
      'completed': 'SUCCESS',
      'done': 'SUCCESS'
    };
    
    const mapped = statusMap[apiStatus] || statusMap[apiStatus.toLowerCase()] || 'IN_PROGRESS';
    logger.debug(`映射任务状态: ${apiStatus} -> ${mapped}`);
    return mapped;
  }

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
   * 提交Imagine任务（文生图/图生图）
   * @param {number} userId - 用户ID
   * @param {number} modelId - 模型ID
   * @param {object} params - 生成参数
   * @param {string} params.prompt - 提示词
   * @param {string} params.negative_prompt - 负面提示词
   * @param {string} params.size - 图片尺寸比例
   * @param {array} params.base64Array - 垫图base64数组（可选，用于图生图）
   */
  static async submitImagine(userId, modelId, params) {
    await safety.checkPrompt(userId, params.prompt, params.negative_prompt || '');
    params = { ...params, base64Array: await safety.inlineReferences(userId, params.base64Array || []) };
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

      // 4. 确定API端点（默认使用fast模式）
      const mode = 'fast';  // 固定使用快速模式
      let endpoint = model.endpoint;

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
        notifyHook: params.notifyHook || model.webhook_url,
        state: JSON.stringify({
          userId,
          generationId,
          modelId
        })
      };

      // 添加垫图base64数组（如果有）
      if (params.base64Array && Array.isArray(params.base64Array) && params.base64Array.length > 0) {
        requestData.base64Array = params.base64Array;
        logger.info('使用垫图生成', {
          userId,
          generationId,
          imageCount: params.base64Array.length
        });
      }

      logger.info('提交Midjourney Imagine任务', {
        userId,
        modelId,
        generationId,
        mode,
        prompt: params.prompt,
        hasReferenceImages: !!(params.base64Array && params.base64Array.length > 0)
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

        // 开始轮询任务状态（传递userId）
        this.pollTaskStatus(taskId, generationId, model, userId);

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
    await safety.assertUser(userId);
    if ((await safety.get(parentGenerationId)).state !== 'pass') throw safety.error('原图须审核通过后才能继续生成');
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

      // 10. 开始轮询任务状态（传递userId）
      this.pollTaskStatus(taskId, generationId, model, userId);

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
   * @param {string} taskId - 任务ID
   * @param {number} generationId - 生成记录ID
   * @param {object} model - 模型对象
   * @param {number} userId - 用户ID（重要：用于目录隔离）
   */
  static async pollTaskStatus(taskId, generationId, model, userId) {
    const pollingInterval = model.polling_interval || 2000;
    const maxPollingTime = model.max_polling_time || 300000;
    const startTime = Date.now();

    // 如果没有传递userId，尝试从数据库获取
    if (!userId) {
      try {
        const generation = await ImageGeneration.findById(generationId);
        if (generation) {
          userId = generation.user_id;
          logger.info('从数据库获取userId', { generationId, userId });
        }
      } catch (e) {
        logger.error('无法获取userId', { generationId, error: e.message });
      }
    }

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
        
        // 映射并更新进度和状态
        if (taskData.progress || taskData.status) {
          const mappedStatus = this.mapTaskStatus(taskData.status);
          const updateData = {};
          
          if (taskData.progress) {
            // 处理进度值，确保是字符串格式
            updateData.progress = String(taskData.progress);
          }
          
          // 只有映射后的状态是有效值才更新
          if (mappedStatus && mappedStatus !== 'NOT_START') {
            updateData.task_status = mappedStatus === 'SUCCESS' ? 'IN_PROGRESS' : mappedStatus;
          }
          
          if (Object.keys(updateData).length > 0) {
            await ImageGeneration.update(generationId, updateData);
          }
        }

        // 判断任务是否完成（使用统一的判断）
        const isSuccess = taskData.status === 'SUCCESS' || 
                         taskData.status === 'success' || 
                         taskData.status === 'completed' ||
                         taskData.status === 'done';
                         
        const isFailure = taskData.status === 'FAILURE' || 
                         taskData.status === 'failure' || 
                         taskData.status === 'failed';

        if (isSuccess) {
          // 下载并保存图片（传递userId实现目录隔离）
          const imageService = require('./imageService');
          const { localPath, thumbnailPath, fileSize } = await imageService.downloadAndSaveImage(
            taskData.imageUrl,
            generationId,
            userId  // 重要：传递userId
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
            image_url: null,
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
            userId,
            time: Date.now() - startTime
          });

        } else if (isFailure) {
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
            userId,
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
          userId,
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
    // Webhook payloads are untrusted. Completion is handled only by authenticated
    // polling against the configured provider; a posted URL/state cannot publish pixels.
    return false;
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
        data: result.rows.map(({ id, generation_id, task_id, action, status, submit_time, finish_time }) => ({ id, generation_id, task_id, action, status, submit_time, finish_time })),
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
