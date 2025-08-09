/**
 * 图片生成历史记录模型
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class ImageGeneration {
  /**
   * 创建生成记录
   */
  static async create(data) {
    try {
      const {
        user_id,
        model_id,
        prompt,
        negative_prompt = null,
        size = '1024x1024',
        seed = -1,
        guidance_scale = 2.5,
        watermark = 1,
        status = 'pending',
        credits_consumed = 0
      } = data;

      const query = `
        INSERT INTO image_generations 
        (user_id, model_id, prompt, negative_prompt, size, seed, 
         guidance_scale, watermark, status, credits_consumed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        user_id,
        model_id,
        prompt,
        negative_prompt,
        size,
        seed,
        guidance_scale,
        watermark,
        status,
        credits_consumed
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建图片生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 更新生成记录
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'image_url', 'local_path', 'thumbnail_path', 'file_size',
        'status', 'error_message', 'credits_consumed', 'generation_time',
        'is_favorite', 'is_public'
      ];

      const fields = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }

      if (fields.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE image_generations SET ${fields.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);

      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新图片生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的生成历史
   */
  static async getUserHistory(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status = null,
        is_favorite = null,
        model_id = null
      } = options;

      const offset = (page - 1) * limit;
      const conditions = ['ig.user_id = ?'];
      const params = [userId];

      if (status) {
        conditions.push('ig.status = ?');
        params.push(status);
      }

      if (is_favorite !== null) {
        conditions.push('ig.is_favorite = ?');
        params.push(is_favorite);
      }

      if (model_id) {
        conditions.push('ig.model_id = ?');
        params.push(model_id);
      }

      const whereClause = conditions.join(' AND ');

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM image_generations ig
        WHERE ${whereClause}
      `;
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      // 获取数据 - 使用simpleQuery处理LIMIT和OFFSET
      const query = `
        SELECT 
          ig.*,
          im.display_name as model_name,
          im.provider,
          im.icon as model_icon
        FROM image_generations ig
        LEFT JOIN image_models im ON ig.model_id = im.id
        WHERE ${whereClause}
        ORDER BY ig.created_at DESC
        LIMIT ? OFFSET ?
      `;

      // 使用simpleQuery而不是query，以正确处理LIMIT和OFFSET
      const queryParams = [...params, limit, offset];
      const result = await dbConnection.simpleQuery(query, queryParams);

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
      logger.error('获取用户生成历史失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取生成记录
   */
  static async findById(id) {
    try {
      const query = `
        SELECT 
          ig.*,
          im.display_name as model_name,
          im.provider,
          im.price_per_image,
          u.username,
          u.email
        FROM image_generations ig
        LEFT JOIN image_models im ON ig.model_id = im.id
        LEFT JOIN users u ON ig.user_id = u.id
        WHERE ig.id = ?
      `;

      const result = await dbConnection.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('获取图片生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 删除生成记录
   */
  static async delete(id, userId = null) {
    try {
      let query = `DELETE FROM image_generations WHERE id = ?`;
      const params = [id];

      // 如果指定了用户ID，确保只能删除自己的记录
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      }

      const result = await dbConnection.query(query, params);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除图片生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 批量删除用户的生成记录
   */
  static async batchDelete(ids, userId) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return false;
      }

      const placeholders = ids.map(() => '?').join(',');
      const query = `
        DELETE FROM image_generations 
        WHERE id IN (${placeholders}) AND user_id = ?
      `;

      const params = [...ids, userId];
      const result = await dbConnection.query(query, params);

      return result.rows.affectedRows;
    } catch (error) {
      logger.error('批量删除图片生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 切换收藏状态
   */
  static async toggleFavorite(id, userId) {
    try {
      const query = `
        UPDATE image_generations 
        SET is_favorite = NOT is_favorite
        WHERE id = ? AND user_id = ?
      `;

      const result = await dbConnection.query(query, [id, userId]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('切换收藏状态失败:', error);
      throw error;
    }
  }

  /**
   * 获取公开的图片（画廊）
   */
  static async getPublicGallery(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        model_id = null
      } = options;

      const offset = (page - 1) * limit;
      const conditions = ['ig.is_public = 1', 'ig.status = "success"'];
      const params = [];

      if (model_id) {
        conditions.push('ig.model_id = ?');
        params.push(model_id);
      }

      const whereClause = conditions.join(' AND ');

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM image_generations ig
        WHERE ${whereClause}
      `;
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      // 获取数据 - 使用simpleQuery处理LIMIT和OFFSET
      const query = `
        SELECT 
          ig.id,
          ig.prompt,
          ig.size,
          ig.local_path,
          ig.thumbnail_path,
          ig.view_count,
          ig.created_at,
          im.display_name as model_name,
          im.icon as model_icon,
          u.username
        FROM image_generations ig
        LEFT JOIN image_models im ON ig.model_id = im.id
        LEFT JOIN users u ON ig.user_id = u.id
        WHERE ${whereClause}
        ORDER BY ig.created_at DESC
        LIMIT ? OFFSET ?
      `;

      // 使用simpleQuery
      const queryParams = [...params, limit, offset];
      const result = await dbConnection.simpleQuery(query, queryParams);

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
      logger.error('获取公开画廊失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的统计信息
   */
  static async getUserStats(userId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_generations,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_generations,
          COUNT(CASE WHEN is_favorite = 1 THEN 1 END) as favorite_count,
          COUNT(CASE WHEN is_public = 1 THEN 1 END) as public_count,
          SUM(credits_consumed) as total_credits_consumed,
          MIN(created_at) as first_generation,
          MAX(created_at) as last_generation
        FROM image_generations
        WHERE user_id = ?
      `;

      const result = await dbConnection.query(query, [userId]);
      return result.rows[0];
    } catch (error) {
      logger.error('获取用户统计信息失败:', error);
      throw error;
    }
  }

  /**
   * 增加查看次数
   */
  static async incrementViewCount(id) {
    try {
      const query = `
        UPDATE image_generations 
        SET view_count = view_count + 1
        WHERE id = ?
      `;

      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('增加查看次数失败:', error);
      throw error;
    }
  }
}

module.exports = ImageGeneration;
