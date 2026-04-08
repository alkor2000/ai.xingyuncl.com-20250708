/**
 * 统计控制器
 * 
 * v1.1 变更：
 *   - 新增 getMyGroupAnnouncement 方法
 *   - 允许所有认证用户读取自己所在组的公告
 *   - getUserCreditsStats 中 today_consumed 查询改用范围条件优化性能
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
   * 
   * v1.1: today_consumed查询改用范围条件 created_at >= CURDATE() 优化性能
   */
  static async getUserCreditsStats(req, res) {
    try {
      const userId = req.user.id;
      
      // 获取用户信息（包含组信息和积分统计）
      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }
      
      // v1.1: 改用范围查询避免DATE()函数导致索引失效
      const todaySql = `
        SELECT COALESCE(SUM(ABS(amount)), 0) as today_consumed
        FROM credit_transactions
        WHERE user_id = ?
          AND created_at >= CURDATE()
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

  /**
   * 获取当前用户所在组的公告
   * GET /api/stats/my-group-announcement
   * 
   * v1.1 新增：解决普通用户无法读取组公告的权限问题
   * - 所有认证用户都可以调用，只返回自己所在组的公告
   * - 无需admin/super_admin权限
   * - 用户未分组时返回空公告
   */
  static async getMyGroupAnnouncement(req, res) {
    try {
      const userId = req.user.id;
      const groupId = req.user.group_id;

      // 用户未分配到任何组，返回空公告
      if (!groupId) {
        return ResponseHelper.success(res, {
          group_id: null,
          group_name: null,
          content: '',
          updated_at: null
        }, '获取组公告成功');
      }

      // 直接查询组的公告字段，不依赖admin层的GroupService
      const sql = `
        SELECT id, name, announcement, updated_at
        FROM user_groups
        WHERE id = ? AND is_active = 1
      `;
      const { rows } = await dbConnection.query(sql, [groupId]);

      if (!rows || rows.length === 0) {
        return ResponseHelper.success(res, {
          group_id: groupId,
          group_name: null,
          content: '',
          updated_at: null
        }, '获取组公告成功');
      }

      const group = rows[0];
      return ResponseHelper.success(res, {
        group_id: group.id,
        group_name: group.name,
        content: group.announcement || '',
        updated_at: group.updated_at
      }, '获取组公告成功');

    } catch (error) {
      logger.error('获取用户组公告失败:', {
        userId: req.user?.id,
        groupId: req.user?.group_id,
        error: error.message
      });
      return ResponseHelper.error(res, '获取组公告失败');
    }
  }
}

module.exports = StatsController;
