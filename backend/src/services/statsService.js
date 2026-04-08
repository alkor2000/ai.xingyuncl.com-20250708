/**
 * 统计服务
 * 处理各类统计数据（无 Redis 版本）
 * 
 * v1.1 变更：
 *   - 修复所有 DATE(created_at) = CURDATE() 为范围查询 created_at >= CURDATE()
 *     避免函数包装导致索引失效引起全表扫描（messages表30秒慢查询根因）
 *   - getRealtimeStats 改为 Promise.all 并行查询所有统计
 *   - 新增查询超时保护，单个查询最多10秒
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class StatsService {
  /**
   * 获取在线用户数
   * 使用范围查询替代 DATE_SUB 函数确保索引可用
   */
  static async getOnlineUsersCount() {
    try {
      const sql = `
        SELECT COUNT(DISTINCT user_id) as count
        FROM user_activities
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      `;
      const { rows } = await dbConnection.query(sql);
      return rows[0]?.count || 0;
    } catch (error) {
      logger.error('获取在线用户数失败:', error);
      return 0;
    }
  }

  /**
   * 更新用户在线状态
   */
  static async updateUserOnlineStatus(userId, isOnline = true) {
    try {
      if (isOnline) {
        await this.recordUserActivity(userId);
      }
    } catch (error) {
      logger.error('更新用户在线状态失败:', error);
    }
  }

  /**
   * 获取今日活跃用户数
   * v1.1: 改用范围查询 created_at >= CURDATE() 避免索引失效
   */
  static async getTodayActiveUsers() {
    try {
      const sql = `
        SELECT COUNT(DISTINCT user_id) as count
        FROM user_activities
        WHERE created_at >= CURDATE()
      `;
      const { rows } = await dbConnection.query(sql);
      return rows[0]?.count || 0;
    } catch (error) {
      logger.error('获取今日活跃用户数失败:', error);
      return 0;
    }
  }

  /**
   * 更新用户每日统计
   */
  static async updateUserDailyStats(userId, stats = {}) {
    try {
      const { messages = 0, tokens = 0 } = stats;
      if (messages > 0 || tokens > 0) {
        await this.recordUserActivity(userId);
      }
    } catch (error) {
      logger.error('更新用户每日统计失败:', error);
    }
  }

  /**
   * 记录用户活动
   */
  static async recordUserActivity(userId) {
    try {
      const sql = `
        INSERT INTO user_activities (user_id)
        VALUES (?)
        ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP
      `;
      await dbConnection.query(sql, [userId]);
    } catch (error) {
      logger.error('记录用户活动失败:', error);
    }
  }

  /**
   * 记录模型使用
   */
  static async recordModelUsage(modelName) {
    try {
      logger.info('记录模型使用', { modelName });
    } catch (error) {
      logger.error('记录模型使用失败:', error);
    }
  }

  /**
   * 获取热门模型
   * v1.1: 改用范围查询 created_at >= CURDATE()
   * 使用参数化 LIMIT 防止 SQL 注入
   */
  static async getPopularModels(limit = 5) {
    try {
      const sql = `
        SELECT model_name, COUNT(*) as usage_count
        FROM billing_logs
        WHERE created_at >= CURDATE()
        GROUP BY model_name
        ORDER BY usage_count DESC
        LIMIT ?
      `;
      const { rows } = await dbConnection.query(sql, [parseInt(limit)]);
      return rows || [];
    } catch (error) {
      logger.error('获取热门模型失败:', error);
      return [];
    }
  }

  /**
   * 带超时保护的查询执行
   * 防止单个慢查询阻塞整个统计接口
   * 
   * @param {Promise} queryPromise - 数据库查询Promise
   * @param {*} defaultValue - 超时时返回的默认值
   * @param {number} timeoutMs - 超时时间（毫秒），默认10秒
   * @returns {Promise} 查询结果或默认值
   */
  static async queryWithTimeout(queryPromise, defaultValue, timeoutMs = 10000) {
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        logger.warn('统计查询超时', { timeoutMs });
        resolve(defaultValue);
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([queryPromise, timeoutPromise]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 获取实时统计数据
   * v1.1 优化：
   *   - 所有SQL改用范围查询避免全表扫描
   *   - 所有查询并行执行（Promise.all）
   *   - 每个查询有10秒超时保护
   */
  static async getRealtimeStats() {
    try {
      // v1.1: messages表查询改用范围条件，可命中 created_at 索引
      const todayStatsPromise = dbConnection.query(`
        SELECT 
          COUNT(DISTINCT m.id) as today_messages,
          COALESCE(SUM(m.tokens), 0) as today_tokens,
          COUNT(DISTINCT m.conversation_id) as today_conversations
        FROM messages m
        WHERE m.created_at >= CURDATE()
      `);

      const totalUsersPromise = dbConnection.query(`
        SELECT COUNT(*) as total_users
        FROM users
        WHERE deleted_at IS NULL
      `);

      const onlineCountPromise = this.getOnlineUsersCount();
      const todayActiveCountPromise = this.getTodayActiveUsers();
      const popularModelsPromise = this.getPopularModels(3);

      // v1.1: 所有查询并行执行+超时保护，大幅减少总耗时
      const [todayResult, totalResult, onlineCount, todayActiveCount, popularModels] = await Promise.all([
        this.queryWithTimeout(todayStatsPromise, { rows: [{ today_messages: 0, today_tokens: 0, today_conversations: 0 }] }),
        this.queryWithTimeout(totalUsersPromise, { rows: [{ total_users: 0 }] }),
        this.queryWithTimeout(onlineCountPromise, 0),
        this.queryWithTimeout(todayActiveCountPromise, 0),
        this.queryWithTimeout(popularModelsPromise, [])
      ]);

      const todayRows = todayResult.rows;
      const totalRows = totalResult.rows;

      return {
        online_users: onlineCount,
        today_active_users: todayActiveCount,
        today_messages: parseInt(todayRows[0]?.today_messages) || 0,
        today_tokens: parseInt(todayRows[0]?.today_tokens) || 0,
        today_conversations: parseInt(todayRows[0]?.today_conversations) || 0,
        total_users: parseInt(totalRows[0]?.total_users) || 0,
        popular_models: popularModels,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('获取实时统计失败:', error);
      return {
        online_users: 0,
        today_active_users: 0,
        today_messages: 0,
        today_tokens: 0,
        today_conversations: 0,
        total_users: 0,
        popular_models: [],
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = StatsService;
