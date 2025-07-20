/**
 * 统计控制器
 */

const StatsService = require('../services/statsService');
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
}

module.exports = StatsController;
