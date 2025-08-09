/**
 * 图像生成模型配置
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const crypto = require('crypto');

class ImageModel {
  /**
   * 获取所有图像模型
   */
  static async findAll(onlyActive = false) {
    try {
      let query = `
        SELECT id, name, display_name, description, provider, endpoint, api_key, model_id,
               price_per_image, sizes_supported, max_prompt_length, default_size,
               default_guidance_scale, example_prompt, example_image, icon,
               is_active, sort_order, created_at, updated_at
        FROM image_models
      `;
      
      if (onlyActive) {
        query += ' WHERE is_active = 1';
      }
      
      query += ' ORDER BY sort_order ASC, id ASC';
      
      const result = await dbConnection.query(query);
      
      // 解析JSON字段，但不返回实际的api_key内容
      return result.rows.map(model => {
        const { api_key, ...modelData } = model;
        return {
          ...modelData,
          price_per_image: parseFloat(model.price_per_image) || 1, // 转换为数字
          has_api_key: !!api_key,  // 只返回是否配置了API密钥
          sizes_supported: typeof model.sizes_supported === 'string' 
            ? JSON.parse(model.sizes_supported) 
            : model.sizes_supported
        };
      });
    } catch (error) {
      logger.error('获取图像模型列表失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取模型
   */
  static async findById(id) {
    try {
      const query = `
        SELECT * FROM image_models WHERE id = ?
      `;
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const model = result.rows[0];
      
      // 解析JSON字段和转换数值类型
      if (typeof model.sizes_supported === 'string') {
        model.sizes_supported = JSON.parse(model.sizes_supported);
      }
      
      // 重要：将price_per_image转换为数字类型
      model.price_per_image = parseFloat(model.price_per_image) || 1;
      model.default_guidance_scale = parseFloat(model.default_guidance_scale) || 2.5;
      model.max_prompt_length = parseInt(model.max_prompt_length) || 1000;
      
      return model;
    } catch (error) {
      logger.error('获取图像模型失败:', error);
      throw error;
    }
  }

  /**
   * 根据名称获取模型
   */
  static async findByName(name) {
    try {
      const query = `
        SELECT * FROM image_models WHERE name = ?
      `;
      const result = await dbConnection.query(query, [name]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const model = result.rows[0];
      
      // 解析JSON字段和转换数值类型
      if (typeof model.sizes_supported === 'string') {
        model.sizes_supported = JSON.parse(model.sizes_supported);
      }
      
      // 重要：将price_per_image转换为数字类型
      model.price_per_image = parseFloat(model.price_per_image) || 1;
      model.default_guidance_scale = parseFloat(model.default_guidance_scale) || 2.5;
      model.max_prompt_length = parseInt(model.max_prompt_length) || 1000;
      
      return model;
    } catch (error) {
      logger.error('根据名称获取图像模型失败:', error);
      throw error;
    }
  }

  /**
   * 创建新模型
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
        price_per_image = 1.00,
        sizes_supported = ['1024x1024'],
        max_prompt_length = 1000,
        default_size = '1024x1024',
        default_guidance_scale = 2.5,
        example_prompt,
        example_image,
        icon = 'PictureOutlined',
        is_active = 1,
        sort_order = 0
      } = modelData;

      // 加密API密钥
      let encryptedApiKey = null;
      if (api_key) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-encryption-key', 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(api_key, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        encryptedApiKey = JSON.stringify({
          encrypted: true,
          data: encrypted,
          iv: iv.toString('hex')
        });
      }

      const query = `
        INSERT INTO image_models 
        (name, display_name, description, provider, endpoint, api_key, model_id,
         price_per_image, sizes_supported, max_prompt_length, default_size,
         default_guidance_scale, example_prompt, example_image, icon,
         is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const result = await dbConnection.query(query, [
        name,
        display_name,
        description,
        provider,
        endpoint,
        encryptedApiKey,
        model_id,
        price_per_image,
        JSON.stringify(sizes_supported),
        max_prompt_length,
        default_size,
        default_guidance_scale,
        example_prompt,
        example_image,
        icon,
        is_active,
        sort_order
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建图像模型失败:', error);
      throw error;
    }
  }

  /**
   * 更新模型
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'display_name', 'description', 'endpoint', 'api_key', 'model_id',
        'price_per_image', 'sizes_supported', 'max_prompt_length', 'default_size',
        'default_guidance_scale', 'example_prompt', 'example_image', 'icon',
        'is_active', 'sort_order'
      ];

      const fields = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          
          if (field === 'api_key' && updateData[field]) {
            // 加密API密钥
            const algorithm = 'aes-256-cbc';
            const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-encryption-key', 'salt', 32);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(algorithm, key, iv);
            let encrypted = cipher.update(updateData[field], 'utf8', 'hex');
            encrypted += cipher.final('hex');
            values.push(JSON.stringify({
              encrypted: true,
              data: encrypted,
              iv: iv.toString('hex')
            }));
          } else if (field === 'sizes_supported' && Array.isArray(updateData[field])) {
            values.push(JSON.stringify(updateData[field]));
          } else {
            values.push(updateData[field]);
          }
        }
      }

      if (fields.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE image_models SET ${fields.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);

      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新图像模型失败:', error);
      throw error;
    }
  }

  /**
   * 删除模型
   */
  static async delete(id) {
    try {
      const query = `DELETE FROM image_models WHERE id = ?`;
      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除图像模型失败:', error);
      throw error;
    }
  }

  /**
   * 解密API密钥
   */
  static decryptApiKey(encryptedData) {
    try {
      if (!encryptedData) return null;
      
      const data = typeof encryptedData === 'string' 
        ? JSON.parse(encryptedData) 
        : encryptedData;
      
      if (!data.encrypted) return data;
      
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-encryption-key', 'salt', 32);
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
}

module.exports = ImageModel;
