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
      
      // 获取AI模型统计（传递currentUser以支持组级别过滤）
      const modelStats = await StatsService.getModelStats(currentUser);

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
   * 获取AI模型统计（包含对话模型和图像生成模型） - 支持基于用户组的过滤
   */
  static async getModelStats(currentUser = null) {
    try {
      let chatModelsSql;
      let imageModelsSql;
      let params = [];
      
      // 判断是否需要组过滤
      const needGroupFilter = currentUser && currentUser.role === 'admin' && currentUser.group_id;
      
      if (needGroupFilter) {
        // 组管理员：只统计本组用户的使用情况
        chatModelsSql = `
          SELECT 
            am.id,
            am.name as model_name,
            am.display_name,
            am.provider,
            am.credits_per_chat as credits_per_use,
            am.is_active,
            'chat' as model_type,
            COUNT(DISTINCT c.id) as conversation_count,
            COUNT(DISTINCT c.user_id) as unique_users,
            SUM(c.total_tokens) as total_tokens,
            SUM(c.message_count) as total_messages,
            AVG(c.message_count) as avg_messages_per_conversation,
            SUM(c.message_count * am.credits_per_chat) as total_credits_consumed,
            MAX(c.created_at) as last_used_at
          FROM ai_models am
          LEFT JOIN conversations c ON am.name = c.model_name
          LEFT JOIN users u ON c.user_id = u.id
          WHERE am.is_active = 1
            AND (c.id IS NULL OR u.group_id = ?)
          GROUP BY am.id
          HAVING conversation_count > 0
        `;
        
        imageModelsSql = `
          SELECT 
            im.id,
            im.name as model_name,
            im.display_name,
            im.provider,
            im.price_per_image as credits_per_use,
            im.is_active,
            'image' as model_type,
            COUNT(DISTINCT ig.id) as generation_count,
            COUNT(DISTINCT ig.user_id) as unique_users,
            0 as total_tokens,
            COUNT(ig.id) as total_generations,
            0 as avg_messages_per_conversation,
            SUM(ig.credits_consumed) as total_credits_consumed,
            MAX(ig.created_at) as last_used_at
          FROM image_models im
          LEFT JOIN image_generations ig ON im.id = ig.model_id AND ig.status = 'success'
          LEFT JOIN users u ON ig.user_id = u.id
          WHERE im.is_active = 1
            AND (ig.id IS NULL OR u.group_id = ?)
          GROUP BY im.id
          HAVING generation_count > 0
        `;
        
        params = [currentUser.group_id];
      } else {
        // 超级管理员：看到所有统计
        chatModelsSql = `
          SELECT 
            am.id,
            am.name as model_name,
            am.display_name,
            am.provider,
            am.credits_per_chat as credits_per_use,
            am.is_active,
            'chat' as model_type,
            COUNT(DISTINCT c.id) as conversation_count,
            COUNT(DISTINCT c.user_id) as unique_users,
            SUM(c.total_tokens) as total_tokens,
            SUM(c.message_count) as total_messages,
            AVG(c.message_count) as avg_messages_per_conversation,
            SUM(c.message_count * am.credits_per_chat) as total_credits_consumed,
            MAX(c.created_at) as last_used_at
          FROM ai_models am
          LEFT JOIN conversations c ON am.name = c.model_name
          WHERE am.is_active = 1
          GROUP BY am.id
        `;
        
        imageModelsSql = `
          SELECT 
            im.id,
            im.name as model_name,
            im.display_name,
            im.provider,
            im.price_per_image as credits_per_use,
            im.is_active,
            'image' as model_type,
            COUNT(DISTINCT ig.id) as generation_count,
            COUNT(DISTINCT ig.user_id) as unique_users,
            0 as total_tokens,
            COUNT(ig.id) as total_generations,
            0 as avg_messages_per_conversation,
            SUM(ig.credits_consumed) as total_credits_consumed,
            MAX(ig.created_at) as last_used_at
          FROM image_models im
          LEFT JOIN image_generations ig ON im.id = ig.model_id AND ig.status = 'success'
          WHERE im.is_active = 1
          GROUP BY im.id
        `;
      }
      
      // 执行两个查询
      const [chatResult, imageResult] = await Promise.all([
        dbConnection.query(chatModelsSql, params),
        dbConnection.query(imageModelsSql, params)
      ]);
      
      // 合并结果并排序
      const allModels = [
        ...chatResult.rows.map(row => ({
          ...row,
          model_type: 'chat',
          display_name: row.display_name || row.model_name,
          usage_count: row.conversation_count || 0
        })),
        ...imageResult.rows.map(row => ({
          ...row,
          model_type: 'image',
          display_name: row.display_name || row.model_name,
          usage_count: row.generation_count || 0,
          conversation_count: row.generation_count // 为了统一字段名
        }))
      ];
      
      // 按使用次数排序
      allModels.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
      
      // 如果是组管理员，记录日志
      if (needGroupFilter) {
        logger.info('组管理员获取模型统计', {
          adminId: currentUser.id,
          groupId: currentUser.group_id,
          modelCount: allModels.length
        });
      }
      
      return allModels;
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

      // 今日积分消费 - 需要根据用户组过滤
      let todaySql;
      let todayParams = [];
      
      if (groupFilter) {
        // 组管理员：只看本组的消费
        todaySql = `
          SELECT 
            COUNT(*) as transactions_today,
            SUM(ABS(ct.amount)) as credits_consumed_today,
            COUNT(DISTINCT ct.user_id) as active_users_today
          FROM credit_transactions ct
          INNER JOIN users u ON ct.user_id = u.id
          WHERE DATE(ct.created_at) = CURDATE()
            AND ct.transaction_type IN ('chat_consume', 'image_consume')
            AND u.group_id = ?
        `;
        todayParams = groupParams;
      } else {
        // 超级管理员：看所有消费
        todaySql = `
          SELECT 
            COUNT(*) as transactions_today,
            SUM(ABS(amount)) as credits_consumed_today,
            COUNT(DISTINCT user_id) as active_users_today
          FROM credit_transactions
          WHERE DATE(created_at) = CURDATE()
            AND transaction_type IN ('chat_consume', 'image_consume')
        `;
      }
      
      const { rows: today } = await dbConnection.query(todaySql, todayParams);

      // 积分消费趋势（最近7天）- 需要根据用户组过滤
      let trendSql;
      let trendParams = [];
      
      if (groupFilter) {
        // 组管理员：只看本组的趋势
        trendSql = `
          SELECT 
            DATE(ct.created_at) as date,
            ct.transaction_type,
            COUNT(*) as count,
            SUM(ABS(ct.amount)) as amount
          FROM credit_transactions ct
          INNER JOIN users u ON ct.user_id = u.id
          WHERE ct.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND u.group_id = ?
          GROUP BY DATE(ct.created_at), ct.transaction_type
          ORDER BY date DESC
        `;
        trendParams = groupParams;
      } else {
        // 超级管理员：看所有趋势
        trendSql = `
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
      }
      
      const { rows: trend } = await dbConnection.query(trendSql, trendParams);

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
  static async getRealtimeStats(filterOptions = {}) {
    try {
      const { groupId } = filterOptions;
      let params = [];
      
      // 在线用户数（最近5分钟有活动）
      let onlineUsersSql;
      if (groupId) {
        // 组管理员：只统计本组在线用户
        onlineUsersSql = `
          SELECT COUNT(DISTINCT us.user_id) as online_users
          FROM user_sessions us
          INNER JOIN users u ON us.user_id = u.id
          WHERE us.last_activity_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            AND u.group_id = ?
        `;
        params = [groupId];
      } else {
        // 超级管理员：统计所有在线用户
        onlineUsersSql = `
          SELECT COUNT(DISTINCT user_id) as online_users
          FROM user_sessions
          WHERE last_activity_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        `;
      }
      
      // 今日新增用户
      let newUsersSql;
      let newUsersParams = [];
      if (groupId) {
        newUsersSql = `
          SELECT COUNT(*) as new_users_today
          FROM users
          WHERE DATE(created_at) = CURDATE()
            AND group_id = ?
        `;
        newUsersParams = [groupId];
      } else {
        newUsersSql = `
          SELECT COUNT(*) as new_users_today
          FROM users
          WHERE DATE(created_at) = CURDATE()
        `;
      }
      
      // 今日对话数
      let conversationsSql;
      let conversationsParams = [];
      if (groupId) {
        conversationsSql = `
          SELECT COUNT(DISTINCT c.id) as conversations_today
          FROM conversations c
          INNER JOIN users u ON c.user_id = u.id
          WHERE DATE(c.created_at) = CURDATE()
            AND u.group_id = ?
        `;
        conversationsParams = [groupId];
      } else {
        conversationsSql = `
          SELECT COUNT(*) as conversations_today
          FROM conversations
          WHERE DATE(created_at) = CURDATE()
        `;
      }
      
      // 今日消息数
      let messagesSql;
      let messagesParams = [];
      if (groupId) {
        messagesSql = `
          SELECT COUNT(m.id) as messages_today
          FROM messages m
          INNER JOIN conversations c ON m.conversation_id = c.id
          INNER JOIN users u ON c.user_id = u.id
          WHERE DATE(m.created_at) = CURDATE()
            AND u.group_id = ?
        `;
        messagesParams = [groupId];
      } else {
        messagesSql = `
          SELECT COUNT(*) as messages_today
          FROM messages
          WHERE DATE(created_at) = CURDATE()
        `;
      }

      const [onlineUsers, newUsers, conversations, messages] = await Promise.all([
        dbConnection.query(onlineUsersSql, params),
        dbConnection.query(newUsersSql, newUsersParams),
        dbConnection.query(conversationsSql, conversationsParams),
        dbConnection.query(messagesSql, messagesParams)
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
      const { startDate, endDate, groupId = null, format = 'json', limitToGroup = false } = options;

      // 构建用户对象，用于传递给getSystemStats
      let currentUser = null;
      if (limitToGroup && groupId) {
        currentUser = {
          role: 'admin',
          group_id: groupId
        };
      }

      const stats = await StatsService.getSystemStats(currentUser);
      
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
