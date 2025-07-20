/**
 * 统计控制器
 */

const StatsService = require('../services/statsService');
const User = require('../models/User');
const dbConnection = require('../database/connection');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class StatsController {
  /**
   * 获取实时统计数据
   * GET /api/stats/realtime
   */
  static async getRealtimeStats(req, res) {
    try {
      const stats = await StatsService.getRealtimeStats();
      
      return ResponseHelper.success(res, stats, '获取实时统计成功');
    } catch (error) {
      logger.error('获取实时统计失败:', error);
      return ResponseHelper.error(res, '获取实时统计失败');
    }
  }

  /**
   * 获取在线用户列表
   * GET /api/stats/online-users
   */
  static async getOnlineUsers(req, res) {
    try {
      const userIds = await StatsService.getOnlineUsers();
      
      return ResponseHelper.success(res, {
        count: userIds.length,
        users: userIds
      }, '获取在线用户成功');
    } catch (error) {
      logger.error('获取在线用户失败:', error);
      return ResponseHelper.error(res, '获取在线用户失败');
    }
  }

  /**
   * 心跳接口
   * POST /api/stats/heartbeat
   */
  static async heartbeat(req, res) {
    try {
      const userId = req.user.id;
      
      await StatsService.updateUserOnlineStatus(userId, true);
      
      return ResponseHelper.success(res, {
        timestamp: new Date().toISOString()
      }, '心跳更新成功');
    } catch (error) {
      logger.error('心跳更新失败:', error);
      return ResponseHelper.error(res, '心跳更新失败');
    }
  }

  /**
   * 获取用户积分统计信息
   * GET /api/stats/user-credits
   */
  static async getUserCreditsStats(req, res) {
    try {
      const userId = req.user.id;
      
      // 获取用户信息（包含组信息和积分统计）
      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }
      
      // 获取今日积分消耗
      const todaySql = `
        SELECT COALESCE(SUM(ABS(amount)), 0) as today_consumed
        FROM credit_transactions
        WHERE user_id = ?
          AND DATE(created_at) = CURDATE()
          AND transaction_type = 'chat_consume'
      `;
      
      const { rows } = await dbConnection.query(todaySql, [userId]);
      const todayConsumed = rows[0]?.today_consumed || 0;
      
      // 获取积分统计信息
      const creditsStats = user.getCreditsStats();
      
      return ResponseHelper.success(res, {
        group_name: user.group_name || '默认组',
        group_color: user.group_color || '#1677ff',
        credits_total: creditsStats.quota,
        credits_remaining: creditsStats.remaining,
        credits_used: creditsStats.used,
        today_consumed: todayConsumed,
        is_expired: creditsStats.isExpired,
        expire_at: creditsStats.expireAt,
        remaining_days: creditsStats.remainingDays
      }, '获取用户积分统计成功');
      
    } catch (error) {
      logger.error('获取用户积分统计失败:', error);
      return ResponseHelper.error(res, '获取用户积分统计失败');
    }
  }
}

module.exports = StatsController;
