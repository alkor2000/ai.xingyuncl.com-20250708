/**
 * 统计服务层 - 处理系统统计相关的业务逻辑
 */

const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError } = require('../../utils/errors');

class StatsService {
  /**
   * 获取系统统计数据
   */
  static async getSystemStats(currentUser = null) {
    try {
      let groupFilter = '';
      let groupParams = [];

      // 如果是普通管理员，只能看到自己组的统计
      if (currentUser && currentUser.role === 'admin' && currentUser.group_id) {
        groupFilter = 'WHERE u.group_id = ?';
        groupParams = [currentUser.group_id];
      }

      // 获取用户统计
      const userStats = await StatsService.getUserStats(groupFilter, groupParams);
      
      // 获取分组统计
      const groupStats = await StatsService.getGroupStats(currentUser);
      
      // 获取对话统计
      const conversationStats = await StatsService.getConversationStats(currentUser);
      
      // 获取AI模型统计
      const modelStats = await StatsService.getModelStats();

      // 获取积分统计
      const creditsStats = await StatsService.getCreditsStats(groupFilter, groupParams);

      return {
        users: userStats,
        groups: groupStats,
        conversations: conversationStats,
        models: modelStats,
        credits: creditsStats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('获取系统统计失败', { error: error.message });
      throw new DatabaseError('获取系统统计失败', error);
    }
  }

  /**
   * 获取用户统计
   */
  static async getUserStats(groupFilter = '', groupParams = []) {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_users,
          SUM(CASE WHEN role = 'admin' OR role = 'super_admin' THEN 1 ELSE 0 END) as admin_users,
          SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as normal_users,
          SUM(used_tokens) as total_tokens_used,
          AVG(used_tokens) as avg_tokens_per_user,
          SUM(credits_quota) as total_credits_quota,
          SUM(used_credits) as total_credits_used,
          AVG(credits_quota - used_credits) as avg_credits_remaining,
          COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as new_users_today,
          COUNT(CASE WHEN DATE(last_login_at) = CURDATE() THEN 1 END) as active_users_today
        FROM users u
        ${groupFilter}
      `;
      
      const { rows } = await dbConnection.query(sql, groupParams);
      return rows[0] || {};
    } catch (error) {
      logger.error('获取用户统计失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取分组统计
   */
  static async getGroupStats(currentUser = null) {
    try {
      let sql;
      let params = [];
      
      if (currentUser && currentUser.role === 'admin' && currentUser.group_id) {
        // 管理员只能看到自己组的统计
        sql = `
          SELECT g.id, g.name, g.color, 
                 COUNT(u.id) as user_count, 
                 AVG(u.used_tokens) as avg_tokens,
                 AVG(u.used_credits) as avg_credits,
                 SUM(u.credits_quota - u.used_credits) as total_credits_remaining,
                 SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) as active_users
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id
          WHERE g.id = ?
          GROUP BY g.id
        `;
        params = [currentUser.group_id];
      } else {
        // 超级管理员可以看到所有组
        sql = `
          SELECT g.id, g.name, g.color, 
                 COUNT(u.id) as user_count, 
                 AVG(u.used_tokens) as avg_tokens,
                 AVG(u.used_credits) as avg_credits,
                 SUM(u.credits_quota - u.used_credits) as total_credits_remaining,
                 SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) as active_users
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id
          GROUP BY g.id
          ORDER BY g.sort_order ASC, g.created_at ASC
        `;
      }
      
      const { rows } = await dbConnection.query(sql, params);
      return rows;
    } catch (error) {
      logger.error('获取分组统计失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取对话统计
   */
  static async getConversationStats(currentUser = null) {
    try {
      let sql;
      let params = [];
      
      if (currentUser && currentUser.role === 'admin' && currentUser.group_id) {
        // 管理员只能看到同组用户的对话统计
        sql = `
          SELECT 
            COUNT(DISTINCT c.id) as total_conversations,
            SUM(c.message_count) as total_messages,
            SUM(c.total_tokens) as total_tokens,
            AVG(c.message_count) as avg_messages_per_conversation,
            COUNT(DISTINCT c.user_id) as unique_users,
            COUNT(CASE WHEN DATE(c.created_at) = CURDATE() THEN 1 END) as conversations_today
          FROM conversations c
          INNER JOIN users u ON c.user_id = u.id
          WHERE u.group_id = ?
        `;
        params = [currentUser.group_id];
      } else {
        // 超级管理员看到所有统计
        sql = `
          SELECT 
            COUNT(*) as total_conversations,
            SUM(message_count) as total_messages,
            SUM(total_tokens) as total_tokens,
            AVG(message_count) as avg_messages_per_conversation,
            COUNT(DISTINCT user_id) as unique_users,
            COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as conversations_today
          FROM conversations
        `;
      }
      
      const { rows } = await dbConnection.query(sql, params);
      return rows[0] || {};
    } catch (error) {
      logger.error('获取对话统计失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取AI模型统计
   */
  static async getModelStats() {
    try {
      const sql = `
        SELECT 
          am.id,
          am.name,
          am.display_name,
          am.provider,
          am.credits_per_chat,
          am.is_active,
          COUNT(DISTINCT c.id) as conversation_count,
          COUNT(DISTINCT c.user_id) as unique_users,
          SUM(c.total_tokens) as total_tokens,
          SUM(c.message_count) as total_messages,
          AVG(c.message_count) as avg_messages_per_conversation,
          MAX(c.created_at) as last_used_at
        FROM ai_models am
        LEFT JOIN conversations c ON am.name = c.model_name
        WHERE am.is_active = 1
        GROUP BY am.id
        ORDER BY conversation_count DESC
      `;
      
      const { rows } = await dbConnection.query(sql);
      return rows;
    } catch (error) {
      logger.error('获取AI模型统计失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取积分统计
   */
  static async getCreditsStats(groupFilter = '', groupParams = []) {
    try {
      // 积分概况
      const overviewSql = `
        SELECT 
          SUM(credits_quota) as total_quota,
          SUM(used_credits) as total_used,
          SUM(credits_quota - used_credits) as total_balance,
          AVG(credits_quota) as avg_quota_per_user,
          AVG(used_credits) as avg_used_per_user,
          COUNT(CASE WHEN credits_expire_at < NOW() THEN 1 END) as expired_users,
          COUNT(CASE WHEN credits_expire_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY) THEN 1 END) as expiring_soon
        FROM users u
        ${groupFilter}
      `;
      
      const { rows: overview } = await dbConnection.query(overviewSql, groupParams);

      // 今日积分消费
      const todaySql = `
        SELECT 
          COUNT(*) as transactions_today,
          SUM(ABS(amount)) as credits_consumed_today,
          COUNT(DISTINCT user_id) as active_users_today
        FROM credit_transactions
        WHERE DATE(created_at) = CURDATE()
          AND transaction_type = 'chat_consume'
      `;
      
      const { rows: today } = await dbConnection.query(todaySql);

      // 积分消费趋势（最近7天）
      const trendSql = `
        SELECT 
          DATE(created_at) as date,
          transaction_type,
          COUNT(*) as count,
          SUM(ABS(amount)) as amount
        FROM credit_transactions
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at), transaction_type
        ORDER BY date DESC
      `;
      
      const { rows: trend } = await dbConnection.query(trendSql);

      return {
        overview: overview[0] || {},
        today: today[0] || {},
        trend
      };
    } catch (error) {
      logger.error('获取积分统计失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取实时统计数据
   */
  static async getRealtimeStats() {
    try {
      // 在线用户数（最近5分钟有活动）
      const onlineUsersSql = `
        SELECT COUNT(DISTINCT user_id) as online_users
        FROM user_sessions
        WHERE last_activity_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
      `;
      
      // 今日新增用户
      const newUsersSql = `
        SELECT COUNT(*) as new_users_today
        FROM users
        WHERE DATE(created_at) = CURDATE()
      `;
      
      // 今日对话数
      const conversationsSql = `
        SELECT COUNT(*) as conversations_today
        FROM conversations
        WHERE DATE(created_at) = CURDATE()
      `;
      
      // 今日消息数
      const messagesSql = `
        SELECT COUNT(*) as messages_today
        FROM messages
        WHERE DATE(created_at) = CURDATE()
      `;

      const [onlineUsers, newUsers, conversations, messages] = await Promise.all([
        dbConnection.query(onlineUsersSql),
        dbConnection.query(newUsersSql),
        dbConnection.query(conversationsSql),
        dbConnection.query(messagesSql)
      ]);

      return {
        online_users: onlineUsers.rows[0]?.online_users || 0,
        new_users_today: newUsers.rows[0]?.new_users_today || 0,
        conversations_today: conversations.rows[0]?.conversations_today || 0,
        messages_today: messages.rows[0]?.messages_today || 0,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('获取实时统计失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 生成统计报表
   */
  static async generateReport(options = {}) {
    try {
      const { startDate, endDate, groupId = null, format = 'json' } = options;

      // 这里可以实现更复杂的报表生成逻辑
      // 包括导出为Excel、PDF等格式

      const stats = await StatsService.getSystemStats();
      
      return {
        report: {
          generated_at: new Date().toISOString(),
          period: {
            start: startDate || 'all',
            end: endDate || 'now'
          },
          data: stats
        }
      };
    } catch (error) {
      logger.error('生成统计报表失败', { error: error.message });
      throw error;
    }
  }
}

module.exports = StatsService;
