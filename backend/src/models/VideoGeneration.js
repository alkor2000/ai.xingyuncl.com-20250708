/**
 * 视频生成记录模型
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class VideoGeneration {
  /**
   * 创建生成记录
   */
  static async create(generationData) {
    try {
      const {
        user_id,
        model_id,
        prompt,
        negative_prompt = null,
        first_frame_image = null,
        last_frame_image = null,
        generation_mode = 'text_to_video',
        resolution,
        duration,
        fps = 24,
        ratio = '16:9',
        seed = -1,
        watermark = false,
        camera_fixed = false,
        task_id = null,
        status = 'pending',
        credits_consumed = 0
      } = generationData;

      const query = `
        INSERT INTO video_generations (
          user_id, model_id, prompt, negative_prompt,
          first_frame_image, last_frame_image, generation_mode,
          resolution, duration, fps, ratio, seed, watermark, camera_fixed,
          task_id, status, credits_consumed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        user_id, model_id, prompt, negative_prompt,
        first_frame_image, last_frame_image, generation_mode,
        resolution, duration, fps, ratio, seed, watermark, camera_fixed,
        task_id, status, credits_consumed
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建视频生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 更新生成记录
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'task_id', 'status', 'progress', 'error_message',
        'video_url', 'local_path', 'thumbnail_path', 'preview_gif_path', 'last_frame_path',
        'file_size', 'video_width', 'video_height', 'video_duration',
        'generation_time', 'completed_at', 'is_public'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }

      if (updates.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE video_generations SET ${updates.join(', ')} WHERE id = ?`;
      
      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新视频生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID查找记录
   */
  static async findById(id) {
    try {
      const query = `
        SELECT vg.*, vm.display_name as model_name, vm.provider, vm.generation_type,
               u.username
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        LEFT JOIN users u ON vg.user_id = u.id
        WHERE vg.id = ?
      `;
      
      const result = await dbConnection.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('查找视频生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 根据任务ID查找记录
   */
  static async findByTaskId(taskId) {
    try {
      const query = `
        SELECT vg.*, vm.display_name as model_name, vm.provider, vm.generation_type
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        WHERE vg.task_id = ?
      `;
      
      const result = await dbConnection.query(query, [taskId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('根据任务ID查找视频生成记录失败:', error);
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
      
      // 确保参数是整数
      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const offset = (pageInt - 1) * limitInt;
      
      // 构建查询条件
      let whereConditions = ['vg.user_id = ?'];
      const params = [userId];
      
      if (status) {
        whereConditions.push('vg.status = ?');
        params.push(status);
      }
      
      if (is_favorite !== null && is_favorite !== undefined) {
        whereConditions.push('vg.is_favorite = ?');
        params.push(is_favorite);
      }
      
      if (model_id) {
        whereConditions.push('vg.model_id = ?');
        params.push(model_id);
      }
      
      const whereClause = whereConditions.join(' AND ');
      
      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM video_generations vg
        WHERE ${whereClause}
      `;
      
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;
      
      // 获取数据 - 直接拼接LIMIT和OFFSET到SQL中
      const dataQuery = `
        SELECT vg.*, vm.display_name as model_name, vm.provider, vm.generation_type
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        WHERE ${whereClause}
        ORDER BY vg.created_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;
      
      // 注意：不再传递LIMIT和OFFSET作为参数
      const dataResult = await dbConnection.query(dataQuery, params);
      
      return {
        data: dataResult.rows,
        pagination: {
          page: pageInt,
          limit: limitInt,
          total,
          totalPages: Math.ceil(total / limitInt)
        }
      };
    } catch (error) {
      logger.error('获取用户视频生成历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取公开画廊
   */
  static async getPublicGallery(options = {}) {
    try {
      const { 
        page = 1, 
        limit = 20,
        model_id = null
      } = options;
      
      // 确保参数是整数
      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const offset = (pageInt - 1) * limitInt;
      
      // 构建查询条件
      let whereConditions = ['vg.is_public = 1', 'vg.status = "succeeded"'];
      const params = [];
      
      if (model_id) {
        whereConditions.push('vg.model_id = ?');
        params.push(model_id);
      }
      
      const whereClause = whereConditions.join(' AND ');
      
      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM video_generations vg
        WHERE ${whereClause}
      `;
      
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;
      
      // 获取数据 - 直接拼接LIMIT和OFFSET到SQL中
      const dataQuery = `
        SELECT vg.*, vm.display_name as model_name, vm.provider,
               u.username
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        LEFT JOIN users u ON vg.user_id = u.id
        WHERE ${whereClause}
        ORDER BY vg.created_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;
      
      // 注意：不再传递LIMIT和OFFSET作为参数
      const dataResult = await dbConnection.query(dataQuery, params);
      
      return {
        data: dataResult.rows.map(item => ({
          ...item,
          username: item.username || 'Anonymous'
        })),
        pagination: {
          page: pageInt,
          limit: limitInt,
          total,
          totalPages: Math.ceil(total / limitInt)
        }
      };
    } catch (error) {
      logger.error('获取公开视频画廊失败:', error);
      throw error;
    }
  }

  /**
   * 删除生成记录
   */
  static async delete(id, userId) {
    try {
      const query = `DELETE FROM video_generations WHERE id = ? AND user_id = ?`;
      const result = await dbConnection.query(query, [id, userId]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除视频生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 批量删除
   */
  static async batchDelete(ids, userId) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return 0;
      }
      
      const placeholders = ids.map(() => '?').join(',');
      const query = `
        DELETE FROM video_generations 
        WHERE id IN (${placeholders}) AND user_id = ?
      `;
      
      const params = [...ids, userId];
      const result = await dbConnection.query(query, params);
      
      return result.rows.affectedRows;
    } catch (error) {
      logger.error('批量删除视频生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 切换收藏状态
   */
  static async toggleFavorite(id, userId) {
    try {
      const query = `
        UPDATE video_generations 
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
   * 增加查看次数
   */
  static async incrementViewCount(id) {
    try {
      const query = `
        UPDATE video_generations 
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

  /**
   * 获取用户统计信息
   */
  static async getUserStats(userId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN status = 'succeeded' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN is_favorite = 1 THEN 1 END) as favorite_count,
          COUNT(CASE WHEN is_public = 1 THEN 1 END) as public_count,
          SUM(credits_consumed) as total_credits,
          SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today_count
        FROM video_generations
        WHERE user_id = ?
      `;
      
      const result = await dbConnection.query(query, [userId]);
      
      return result.rows[0] || {
        total_count: 0,
        success_count: 0,
        failed_count: 0,
        favorite_count: 0,
        public_count: 0,
        total_credits: 0,
        today_count: 0
      };
    } catch (error) {
      logger.error('获取用户视频统计信息失败:', error);
      throw error;
    }
  }
}

module.exports = VideoGeneration;
