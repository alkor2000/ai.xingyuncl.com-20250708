/**
 * 统计服务 - 管理实时统计和在线状态
 */

const redisConnection = require('../database/redis');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class StatsService {
  /**
   * 更新用户在线状态
   */
  static async updateUserOnlineStatus(userId, isOnline = true) {
    try {
      if (!redisConnection.isConnected) {
        logger.warn('Redis未连接，无法更新在线状态');
        return false;
      }

      const key = 'online:users';
      const activityKey = 'user:activity';
      const now = Date.now();

      if (isOnline) {
        // 添加到在线用户集合
        await redisConnection.getClient().sAdd(key, userId.toString());
        
        // 更新最后活跃时间
        await redisConnection.getClient().hSet(activityKey, userId.toString(), now.toString());
        
        // 设置过期时间（2分钟）
        await redisConnection.getClient().expire(key, 120);
        
        // 添加到今日活跃用户
        const todayKey = `daily:active:${new Date().toISOString().split('T')[0]}`;
        await redisConnection.getClient().sAdd(todayKey, userId.toString());
        await redisConnection.getClient().expire(todayKey, 86400); // 24小时
        
        logger.info('用户上线', { userId });
      } else {
        // 从在线用户集合移除
        await redisConnection.getClient().sRem(key, userId.toString());
        await redisConnection.getClient().hDel(activityKey, userId.toString());
        
        logger.info('用户下线', { userId });
      }

      return true;
    } catch (error) {
      logger.error('更新用户在线状态失败:', error);
      return false;
    }
  }

  /**
   * 获取在线用户列表
   */
  static async getOnlineUsers() {
    try {
      if (!redisConnection.isConnected) {
        return [];
      }

      const key = 'online:users';
      const userIds = await redisConnection.getClient().sMembers(key);
      
      return userIds.map(id => parseInt(id));
    } catch (error) {
      logger.error('获取在线用户列表失败:', error);
      return [];
    }
  }

  /**
   * 获取在线用户数
   */
  static async getOnlineCount() {
    try {
      if (!redisConnection.isConnected) {
        return 0;
      }

      const key = 'online:users';
      const count = await redisConnection.getClient().sCard(key);
      
      return count || 0;
    } catch (error) {
      logger.error('获取在线用户数失败:', error);
      return 0;
    }
  }

  /**
   * 获取今日活跃用户数
   */
  static async getTodayActiveUsers() {
    try {
      if (!redisConnection.isConnected) {
        // 从数据库获取
        const sql = `
          SELECT COUNT(DISTINCT user_id) as count 
          FROM usage_stats 
          WHERE date = CURDATE()
        `;
        const { rows } = await dbConnection.query(sql);
        return rows[0].count || 0;
      }

      const todayKey = `daily:active:${new Date().toISOString().split('T')[0]}`;
      const count = await redisConnection.getClient().sCard(todayKey);
      
      return count || 0;
    } catch (error) {
      logger.error('获取今日活跃用户数失败:', error);
      return 0;
    }
  }

  /**
   * 记录模型使用
   */
  static async recordModelUsage(modelName) {
    try {
      if (!redisConnection.isConnected) {
        return;
      }

      const key = `model:usage:daily:${new Date().toISOString().split('T')[0]}`;
      await redisConnection.getClient().hIncrBy(key, modelName, 1);
      await redisConnection.getClient().expire(key, 86400); // 24小时
      
    } catch (error) {
      logger.error('记录模型使用失败:', error);
    }
  }

  /**
   * 获取热门模型
   */
  static async getPopularModels(limit = 5) {
    try {
      if (!redisConnection.isConnected) {
        // 从数据库获取
        const sql = `
          SELECT model_name, COUNT(*) as usage_count
          FROM billing_logs
          WHERE DATE(created_at) = CURDATE()
          GROUP BY model_name
          ORDER BY usage_count DESC
          LIMIT ?
        `;
        const { rows } = await dbConnection.query(sql, [limit]);
        return rows;
      }

      const key = `model:usage:daily:${new Date().toISOString().split('T')[0]}`;
      const models = await redisConnection.getClient().hGetAll(key);
      
      // 转换并排序
      const modelArray = Object.entries(models)
        .map(([model_name, usage_count]) => ({
          model_name,
          usage_count: parseInt(usage_count)
        }))
        .sort((a, b) => b.usage_count - a.usage_count)
        .slice(0, limit);
      
      return modelArray;
    } catch (error) {
      logger.error('获取热门模型失败:', error);
      return [];
    }
  }

  /**
   * 获取实时统计数据
   */
  static async getRealtimeStats() {
    try {
      // 获取今日统计
      const todayStatsSql = `
        SELECT 
          COALESCE(SUM(total_messages), 0) as today_messages,
          COALESCE(SUM(total_tokens), 0) as today_tokens,
          COALESCE(SUM(total_conversations), 0) as today_conversations
        FROM usage_stats
        WHERE date = CURDATE()
      `;
      const { rows: todayRows } = await dbConnection.query(todayStatsSql);
      
      // 获取总体统计
      const totalStatsSql = `
        SELECT 
          COUNT(DISTINCT id) as total_users
        FROM users
        WHERE status = 'active'
      `;
      const { rows: totalRows } = await dbConnection.query(totalStatsSql);
      
      // 获取在线用户数
      const onlineCount = await this.getOnlineCount();
      
      // 获取今日活跃用户数
      const todayActiveCount = await this.getTodayActiveUsers();
      
      // 获取热门模型
      const popularModels = await this.getPopularModels(3);
      
      return {
        online_users: onlineCount,
        today_active_users: todayActiveCount,
        today_messages: todayRows[0].today_messages || 0,
        today_tokens: todayRows[0].today_tokens || 0,
        today_conversations: todayRows[0].today_conversations || 0,
        total_users: totalRows[0].total_users || 0,
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

  /**
   * 更新用户日使用统计
   */
  static async updateUserDailyStats(userId, updates = {}) {
    try {
      const { messages = 0, tokens = 0, conversations = 0 } = updates;
      
      const sql = `
        INSERT INTO usage_stats (user_id, date, total_messages, total_tokens, total_conversations)
        VALUES (?, CURDATE(), ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          total_messages = total_messages + VALUES(total_messages),
          total_tokens = total_tokens + VALUES(total_tokens),
          total_conversations = total_conversations + VALUES(total_conversations)
      `;
      
      await dbConnection.query(sql, [userId, messages, tokens, conversations]);
      
      logger.info('用户日统计更新成功', { userId, updates });
    } catch (error) {
      logger.error('更新用户日统计失败:', error);
    }
  }

  /**
   * 清理过期的在线状态
   */
  static async cleanupExpiredOnlineStatus() {
    try {
      if (!redisConnection.isConnected) {
        return;
      }

      const activityKey = 'user:activity';
      const onlineKey = 'online:users';
      const now = Date.now();
      const timeout = 120000; // 2分钟超时
      
      // 获取所有用户活动记录
      const activities = await redisConnection.getClient().hGetAll(activityKey);
      
      for (const [userId, lastActivity] of Object.entries(activities)) {
        const lastActivityTime = parseInt(lastActivity);
        if (now - lastActivityTime > timeout) {
          // 移除超时用户
          await redisConnection.getClient().sRem(onlineKey, userId);
          await redisConnection.getClient().hDel(activityKey, userId);
          logger.info('清理超时用户', { userId });
        }
      }
    } catch (error) {
      logger.error('清理过期在线状态失败:', error);
    }
  }
}

module.exports = StatsService;
