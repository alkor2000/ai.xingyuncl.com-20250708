/**
 * 视频生成记录模型
 *
 * v1.2 关键词搜索 + 通配符转义 + 长度限制
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

const KEYWORD_MAX_LENGTH = 100;

function normalizeKeyword(keyword) {
  if (typeof keyword !== 'string') return '';
  const trimmed = keyword.trim();
  if (!trimmed) return '';
  const truncated = trimmed.substring(0, KEYWORD_MAX_LENGTH);
  return truncated.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
}

class VideoGeneration {
  static async create(generationData) {
    try {
      const {
        user_id, model_id, prompt,
        negative_prompt = null,
        first_frame_image = null, last_frame_image = null,
        generation_mode = 'text_to_video',
        resolution, duration, fps = 24, ratio = '16:9',
        seed = -1, watermark = false, camera_fixed = false,
        task_id = null, status = 'pending', credits_consumed = 0,
        provider = null, orientation = null,
        reference_images = null, generation_id = null,
        started_at = null
      } = generationData;

      const query = `
        INSERT INTO video_generations (
          user_id, model_id, prompt, negative_prompt,
          first_frame_image, last_frame_image, generation_mode,
          resolution, duration, fps, ratio, seed, watermark, camera_fixed,
          task_id, status, credits_consumed,
          provider, orientation, reference_images, generation_id, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await dbConnection.query(query, [
        user_id, model_id, prompt, negative_prompt,
        first_frame_image, last_frame_image, generation_mode,
        resolution, duration, fps, ratio, seed, watermark, camera_fixed,
        task_id, status, credits_consumed,
        provider, orientation, reference_images, generation_id, started_at
      ]);

      return result.rows.insertId;
    } catch (error) {
      logger.error('创建视频生成记录失败:', error);
      throw error;
    }
  }

  static async update(id, updateData) {
    try {
      const allowedFields = [
        'task_id', 'status', 'progress', 'error_message',
        'video_url', 'local_path', 'thumbnail_path', 'preview_gif_path', 'last_frame_path',
        'file_size', 'video_width', 'video_height', 'video_duration',
        'generation_time', 'completed_at', 'is_public',
        'provider', 'orientation', 'reference_images', 'generation_id',
        'oss_video_url', 'oss_thumbnail_url', 'oss_gif_url',
        'raw_response', 'started_at', 'download_attempted', 'download_failed_reason'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }

      if (updates.length === 0) return false;

      values.push(id);
      const query = `UPDATE video_generations SET ${updates.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('更新视频生成记录失败:', error);
      throw error;
    }
  }

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
      if (result.rows.length === 0) return null;
      return result.rows[0];
    } catch (error) {
      logger.error('查找视频生成记录失败:', error);
      throw error;
    }
  }

  static async findByTaskId(taskId) {
    try {
      const query = `
        SELECT vg.*, vm.display_name as model_name, vm.provider, vm.generation_type
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        WHERE vg.task_id = ?
      `;
      const result = await dbConnection.query(query, [taskId]);
      if (result.rows.length === 0) return null;
      return result.rows[0];
    } catch (error) {
      logger.error('根据任务ID查找视频生成记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的生成历史
   * v1.2 keyword 关键词搜索（提示词/负面提示词/模型显示名/provider）
   */
  static async getUserHistory(userId, options = {}) {
    try {
      const {
        page = 1, limit = 20,
        status = null, is_favorite = null,
        model_id = null, keyword = null
      } = options;

      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const offset = (pageInt - 1) * limitInt;

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

      // v1.2 关键词搜索
      const normalizedKeyword = normalizeKeyword(keyword);
      if (normalizedKeyword) {
        whereConditions.push('(vg.prompt LIKE ? OR vg.negative_prompt LIKE ? OR vm.display_name LIKE ? OR vm.provider LIKE ?)');
        const likeValue = `%${normalizedKeyword}%`;
        params.push(likeValue, likeValue, likeValue, likeValue);
      }

      const whereClause = whereConditions.join(' AND ');

      const countQuery = `
        SELECT COUNT(*) as total 
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        WHERE ${whereClause}
      `;
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

      const dataQuery = `
        SELECT vg.*, vm.display_name as model_name, vm.provider, vm.generation_type
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        WHERE ${whereClause}
        ORDER BY vg.created_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;

      const dataResult = await dbConnection.query(dataQuery, params);

      return {
        data: dataResult.rows,
        pagination: {
          page: pageInt, limit: limitInt, total,
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
   * v1.2 keyword 关键词搜索
   */
  static async getPublicGallery(options = {}) {
    try {
      const {
        page = 1, limit = 20,
        model_id = null, keyword = null
      } = options;

      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const offset = (pageInt - 1) * limitInt;

      let whereConditions = ['vg.is_public = 1', 'vg.status = "succeeded"'];
      const params = [];

      if (model_id) {
        whereConditions.push('vg.model_id = ?');
        params.push(model_id);
      }

      const normalizedKeyword = normalizeKeyword(keyword);
      if (normalizedKeyword) {
        whereConditions.push('(vg.prompt LIKE ? OR vg.negative_prompt LIKE ? OR vm.display_name LIKE ? OR vm.provider LIKE ?)');
        const likeValue = `%${normalizedKeyword}%`;
        params.push(likeValue, likeValue, likeValue, likeValue);
      }

      const whereClause = whereConditions.join(' AND ');

      const countQuery = `
        SELECT COUNT(*) as total 
        FROM video_generations vg
        LEFT JOIN video_models vm ON vg.model_id = vm.id
        WHERE ${whereClause}
      `;
      const countResult = await dbConnection.query(countQuery, params);
      const total = countResult.rows[0].total;

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

      const dataResult = await dbConnection.query(dataQuery, params);

      return {
        data: dataResult.rows.map(item => ({
          ...item,
          username: item.username || 'Anonymous'
        })),
        pagination: {
          page: pageInt, limit: limitInt, total,
          totalPages: Math.ceil(total / limitInt)
        }
      };
    } catch (error) {
      logger.error('获取公开视频画廊失败:', error);
      throw error;
    }
  }

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

  static async batchDelete(ids, userId) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) return 0;
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

  static async incrementViewCount(id) {
    try {
      const query = `UPDATE video_generations SET view_count = view_count + 1 WHERE id = ?`;
      const result = await dbConnection.query(query, [id]);
      return result.rows.affectedRows > 0;
    } catch (error) {
      logger.error('增加查看次数失败:', error);
      throw error;
    }
  }

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
        total_count: 0, success_count: 0, failed_count: 0,
        favorite_count: 0, public_count: 0,
        total_credits: 0, today_count: 0
      };
    } catch (error) {
      logger.error('获取用户视频统计信息失败:', error);
      throw error;
    }
  }
}

module.exports = VideoGeneration;
