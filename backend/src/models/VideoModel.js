/**
 * 视频生成模型配置
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const crypto = require('crypto');

class VideoModel {
  /**
   * 获取所有视频模型
   * @param {boolean} activeOnly - 是否只获取激活的模型
   */
  static async findAll(activeOnly = false) {
    try {
      let query = `
        SELECT id, name, display_name, description, provider, endpoint, api_key, model_id,
               generation_type, api_config,
               supports_text_to_video, supports_image_to_video, 
               supports_first_frame, supports_last_frame,
               resolutions_supported, durations_supported, fps_supported, ratios_supported,
               max_prompt_length, default_resolution, default_duration, default_fps, default_ratio,
               base_price, price_config, example_prompt, example_video,
               icon, is_active, sort_order, created_at, updated_at
        FROM video_models
      `;
      
      if (activeOnly) {
        query += ' WHERE is_active = 1';
      }
      
      query += ' ORDER BY sort_order ASC, id DESC';
      
      const result = await dbConnection.query(query);
      
      // 解析JSON字段并添加has_api_key标识
      return result.rows.map(model => {
        // 解析api_config
        let apiConfig = null;
        if (model.api_config) {
          try {
            apiConfig = typeof model.api_config === 'string' 
              ? JSON.parse(model.api_config) 
              : model.api_config;
          } catch (e) {
            apiConfig = null;
          }
        }
        
        // 判断是否已配置API密钥
        let hasApiKey = false;
        if (model.provider === 'kling') {
          // 可灵模型：检查api_config中是否有access_key和secret_key
          hasApiKey = !!(apiConfig && apiConfig.access_key && apiConfig.secret_key);
        } else {
          // 火山引擎模型：检查api_key字段
          hasApiKey = !!(model.api_key && model.api_key !== null && model.api_key !== '');
        }
        
        const parsed = {
          ...model,
          has_api_key: hasApiKey,
          api_config: apiConfig,
          resolutions_supported: typeof model.resolutions_supported === 'string' 
            ? JSON.parse(model.resolutions_supported) 
            : model.resolutions_supported,
          durations_supported: typeof model.durations_supported === 'string'
            ? JSON.parse(model.durations_supported)
            : model.durations_supported,
          fps_supported: typeof model.fps_supported === 'string'
            ? JSON.parse(model.fps_supported)
            : model.fps_supported,
          ratios_supported: typeof model.ratios_supported === 'string'
            ? JSON.parse(model.ratios_supported)
            : model.ratios_supported,
          price_config: typeof model.price_config === 'string'
            ? JSON.parse(model.price_config)
            : model.price_config
        };
        
        // 不返回API密钥本身
        delete parsed.api_key;
        
        return parsed;
      });
    } catch (error) {
      logger.error('获取视频模型列表失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID查找模型
   */
  static async findById(id) {
    try {
      const query = `
        SELECT * FROM video_models WHERE id = ?
      `;
      
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const model = result.rows[0];
      
      // 解析JSON字段
      return {
        ...model,
        resolutions_supported: typeof model.resolutions_supported === 'string' 
          ? JSON.parse(model.resolutions_supported) 
          : model.resolutions_supported,
        durations_supported: typeof model.durations_supported === 'string'
          ? JSON.parse(model.durations_supported)
          : model.durations_supported,
        fps_supported: typeof model.fps_supported === 'string'
          ? JSON.parse(model.fps_supported)
          : model.fps_supported,
        ratios_supported: typeof model.ratios_supported === 'string'
          ? JSON.parse(model.ratios_supported)
          : model.ratios_supported,
        price_config: typeof model.price_config === 'string'
          ? JSON.parse(model.price_config)
          : model.price_config,
        api_config: typeof model.api_config === 'string'
          ? JSON.parse(model.api_config)
          : model.api_config
      };
    } catch (error) {
      logger.error('根据ID查找视频模型失败:', error);
      throw error;
    }
  }

  /**
   * 创建视频模型
   */
  static async create(modelData) {
    try {
      const {
        name,
        display_name,
        description,
        provider = 'volcano',
        endpoint,
        api_key,
        model_id,
        generation_type = 'async',
        api_config = null,
        supports_text_to_video = true,
        supports_image_to_video = false,
        supports_first_frame = false,
        supports_last_frame = false,
        resolutions_supported = ['720p'],
        durations_supported = [5],
        fps_supported = [24],
        ratios_supported = ['16:9'],
        max_prompt_length = 500,
        default_resolution = '720p',
        default_duration = 5,
        default_fps = 24,
        default_ratio = '16:9',
        base_price = 50.00,
        price_config = null,
        example_prompt = '',
        example_video = null,
        icon = 'VideoCameraOutlined',
        is_active = 1,
        sort_order = 0
      } = modelData;

      // 加密API密钥（只对火山引擎）
      const encryptedApiKey = api_key ? VideoModel.encryptApiKey(api_key) : null;

      const query = `
        INSERT INTO video_models (
          name, display_name, description, provider, endpoint, api_key, model_id,
          generation_type, api_config,
          supports_text_to_video, supports_image_to_video, supports_first_frame, supports_last_frame,
          resolutions_supported, durations_supported, fps_supported, ratios_supported,
          max_prompt_length, default_resolution, default_duration, default_fps, default_ratio,
          base_price, price_config, example_prompt, example_video,
          icon, is_active, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        name,
        display_name,
        description,
        provider,
        endpoint,
        encryptedApiKey,
        model_id,
        generation_type,
        JSON.stringify(api_config),
        supports_text_to_video,
        supports_image_to_video,
        supports_first_frame,
        supports_last_frame,
        JSON.stringify(resolutions_supported),
        JSON.stringify(durations_supported),
        JSON.stringify(fps_supported),
        JSON.stringify(ratios_supported),
        max_prompt_length,
        default_resolution,
        default_duration,
        default_fps,
        default_ratio,
        base_price,
        JSON.stringify(price_config),
        example_prompt,
        example_video,
        icon,
        is_active,
        sort_order
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建视频模型失败:', error);
      throw error;
    }
  }

  /**
   * 更新视频模型
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'display_name', 'description', 'endpoint', 'api_key', 'model_id',
        'generation_type', 'api_config',
        'supports_text_to_video', 'supports_image_to_video', 
        'supports_first_frame', 'supports_last_frame',
        'resolutions_supported', 'durations_supported', 'fps_supported', 'ratios_supported',
        'max_prompt_length', 'default_resolution', 'default_duration', 'default_fps', 'default_ratio',
        'base_price', 'price_config', 'example_prompt', 'example_video',
        'icon', 'is_active', 'sort_order'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          let value = updateData[field];
          
          // 处理API密钥加密
          if (field === 'api_key' && value) {
            value = VideoModel.encryptApiKey(value);
          }
          
          // 处理JSON字段
          if (['api_config', 'resolutions_supported', 'durations_supported', 
               'fps_supported', 'ratios_supported', 'price_config'].includes(field) && 
              value !== null && typeof value === 'object') {
            value = JSON.stringify(value);
          }
          
          updates.push(`${field} = ?`);
          values.push(value);
        }
      }

      if (updates.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE video_models SET ${updates.join(', ')} WHERE id = ?`;
      
      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新视频模型失败:', error);
      throw error;
    }
  }

  /**
   * 删除视频模型
   */
  static async delete(id) {
    try {
      const query = `DELETE FROM video_models WHERE id = ?`;
      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除视频模型失败:', error);
      throw error;
    }
  }

  /**
   * 加密API密钥
   */
  static encryptApiKey(apiKey) {
    if (!apiKey) return null;
    
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(
        process.env.JWT_ACCESS_SECRET || 'default-encryption-key',
        'salt',
        32
      );
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return JSON.stringify({
        encrypted: true,
        data: encrypted,
        iv: iv.toString('hex')
      });
    } catch (error) {
      logger.error('加密API密钥失败:', error);
      throw error;
    }
  }

  /**
   * 解密API密钥
   */
  static decryptApiKey(encryptedData) {
    if (!encryptedData) return null;
    
    try {
      const data = typeof encryptedData === 'string' 
        ? JSON.parse(encryptedData) 
        : encryptedData;
      
      if (!data.encrypted) {
        return encryptedData;
      }
      
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(
        process.env.JWT_ACCESS_SECRET || 'default-encryption-key',
        'salt',
        32
      );
      const iv = Buffer.from(data.iv, 'hex');
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(data.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('解密API密钥失败:', error);
      return null;
    }
  }

  /**
   * 计算视频生成价格
   * @param {Object} model - 模型对象
   * @param {string} resolution - 分辨率
   * @param {number} duration - 时长（秒）
   * @returns {number} 积分价格
   */
  static calculatePrice(model, resolution, duration) {
    if (!model || !model.price_config) {
      return model?.base_price || 50;
    }

    const basePrice = model.base_price || 50;
    const config = model.price_config;
    
    // 获取分辨率系数
    const resolutionMultiplier = config.resolution_multiplier?.[resolution] || 1.0;
    
    // 获取时长系数
    const durationMultiplier = config.duration_multiplier?.[String(duration)] || 1.0;
    
    // 计算最终价格
    return Math.ceil(basePrice * resolutionMultiplier * durationMultiplier);
  }
}

module.exports = VideoModel;
