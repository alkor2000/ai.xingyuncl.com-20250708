/**
 * 日历AI分析模型
 * 管理AI分析历史和结果存储
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class CalendarAIAnalysis {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  /**
   * 根据ID查找分析记录
   */
  static async findById(id, userId = null) {
    try {
      let sql = `
        SELECT caa.*, 
               am.display_name as model_display_name,
               u.username
        FROM calendar_ai_analyses caa
        LEFT JOIN ai_models am ON caa.model_id = am.id
        LEFT JOIN users u ON caa.user_id = u.id
        WHERE caa.id = ?
      `;
      
      const params = [id];
      
      if (userId !== null) {
        sql += ' AND caa.user_id = ?';
        params.push(userId);
      }
      
      const { rows } = await dbConnection.query(sql, params);
      
      if (rows.length === 0) {
        return null;
      }
      
      const analysis = new CalendarAIAnalysis(rows[0]);
      
      // 解析JSON结果
      if (analysis.analysis_result && typeof analysis.analysis_result === 'string') {
        try {
          analysis.analysis_result = JSON.parse(analysis.analysis_result);
        } catch (e) {
          logger.warn('解析分析结果JSON失败', { id, error: e.message });
        }
      }
      
      return analysis;
    } catch (error) {
      logger.error('根据ID查找分析记录失败:', error);
      throw new DatabaseError('查找分析记录失败', error);
    }
  }

  /**
   * 获取用户的分析历史列表
   */
  static async getUserAnalyses(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;

      // 获取总数
      const countSql = `
        SELECT COUNT(*) as total 
        FROM calendar_ai_analyses 
        WHERE user_id = ?
      `;
      const { rows: totalRows } = await dbConnection.query(countSql, [userId]);
      const total = totalRows[0].total;

      // 获取列表
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT caa.*,
               am.display_name as model_display_name
        FROM calendar_ai_analyses caa
        LEFT JOIN ai_models am ON caa.model_id = am.id
        WHERE caa.user_id = ?
        ORDER BY caa.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows: analyses } = await dbConnection.simpleQuery(listSql, [userId, limit, offset]);

      // 解析JSON结果
      const parsedAnalyses = analyses.map(analysis => {
        if (analysis.analysis_result && typeof analysis.analysis_result === 'string') {
          try {
            analysis.analysis_result = JSON.parse(analysis.analysis_result);
          } catch (e) {
            logger.warn('解析分析结果JSON失败', { id: analysis.id });
          }
        }
        return new CalendarAIAnalysis(analysis);
      });

      return {
        analyses: parsedAnalyses,
        pagination: {
          page,
          limit,
          total
        }
      };
    } catch (error) {
      logger.error('获取用户分析历史失败:', error);
      throw new DatabaseError('获取分析历史失败', error);
    }
  }

  /**
   * 创建分析记录
   */
  static async create(data, userId) {
    try {
      const {
        scan_date_start,
        scan_date_end,
        model_id,
        model_name,
        analysis_result,
        credits_consumed,
        events_count
      } = data;

      // 验证必填字段
      if (!scan_date_start || !scan_date_end || !model_id) {
        throw new ValidationError('缺少必填字段');
      }

      // 序列化分析结果
      const resultJson = typeof analysis_result === 'object' 
        ? JSON.stringify(analysis_result) 
        : analysis_result;

      const sql = `
        INSERT INTO calendar_ai_analyses (
          user_id, scan_date_start, scan_date_end, model_id, model_name,
          analysis_result, credits_consumed, events_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        userId, scan_date_start, scan_date_end, model_id, model_name,
        resultJson, credits_consumed, events_count
      ]);

      const analysisId = rows.insertId;

      logger.info('AI分析记录创建成功', {
        userId,
        analysisId,
        model_id,
        credits_consumed,
        events_count
      });

      return await CalendarAIAnalysis.findById(analysisId);
    } catch (error) {
      logger.error('创建AI分析记录失败:', error);
      throw new DatabaseError('创建分析记录失败', error);
    }
  }

  /**
   * 删除分析记录
   */
  static async delete(id, userId) {
    try {
      // 检查所有权
      const analysis = await CalendarAIAnalysis.findById(id, userId);
      if (!analysis) {
        throw new ValidationError('分析记录不存在或无权删除');
      }

      const sql = 'DELETE FROM calendar_ai_analyses WHERE id = ?';
      await dbConnection.query(sql, [id]);

      logger.info('AI分析记录删除成功', { userId, analysisId: id });

      return true;
    } catch (error) {
      logger.error('删除AI分析记录失败:', error);
      throw new DatabaseError('删除分析记录失败', error);
    }
  }

  /**
   * 获取用户分析统计
   */
  static async getUserStats(userId) {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total_analyses,
          SUM(credits_consumed) as total_credits,
          SUM(events_count) as total_events_analyzed,
          MAX(created_at) as last_analysis_at
        FROM calendar_ai_analyses
        WHERE user_id = ?
      `;

      const { rows } = await dbConnection.query(sql, [userId]);

      return {
        total_analyses: rows[0].total_analyses || 0,
        total_credits: rows[0].total_credits || 0,
        total_events_analyzed: rows[0].total_events_analyzed || 0,
        last_analysis_at: rows[0].last_analysis_at
      };
    } catch (error) {
      logger.error('获取用户分析统计失败:', error);
      throw new DatabaseError('获取统计失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      user_id: this.user_id,
      scan_date_start: this.scan_date_start,
      scan_date_end: this.scan_date_end,
      model_id: this.model_id,
      model_name: this.model_name,
      model_display_name: this.model_display_name,
      analysis_result: this.analysis_result,
      credits_consumed: this.credits_consumed,
      events_count: this.events_count,
      created_at: this.created_at,
      username: this.username
    };
  }
}

module.exports = CalendarAIAnalysis;
