/**
 * 系统统计控制器 - 使用Service层处理业务逻辑
 */

const { StatsService } = require('../../services/admin');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class SystemStatsController {
  /**
   * 获取系统统计
   */
  static async getSystemStats(req, res) {
    try {
      const currentUser = req.user;
      const stats = await StatsService.getSystemStats(currentUser);

      return ResponseHelper.success(res, stats, '获取系统统计成功');
    } catch (error) {
      logger.error('获取系统统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取系统统计失败');
    }
  }

  /**
   * 获取系统设置
   */
  static async getSystemSettings(req, res) {
    try {
      // 系统设置暂时返回静态配置，后续可以从数据库读取
      const settings = {
        site: {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: {
          allow_register: true,
          default_token_quota: 10000,
          default_group_id: 1,
          default_credits_quota: 1000
        },
        ai: {
          default_model: 'openai/gpt-4.1-mini',
          temperature: 0.0
        },
        credits: {
          default_credits: 1000,
          max_credits: 100000,
          min_credits_for_chat: 1
        }
      };

      return ResponseHelper.success(res, settings, '获取系统设置成功');
    } catch (error) {
      logger.error('获取系统设置失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取系统设置失败');
    }
  }

  /**
   * 更新系统设置
   */
  static async updateSystemSettings(req, res) {
    try {
      const settings = req.body;

      // TODO: 实现系统设置的持久化存储
      logger.info('管理员更新系统设置', { 
        adminId: req.user.id,
        settings
      });

      return ResponseHelper.success(res, settings, '系统设置更新成功');
    } catch (error) {
      logger.error('更新系统设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新系统设置失败');
    }
  }

  /**
   * 获取实时统计数据
   */
  static async getRealtimeStats(req, res) {
    try {
      const stats = await StatsService.getRealtimeStats();

      return ResponseHelper.success(res, stats, '获取实时统计成功');
    } catch (error) {
      logger.error('获取实时统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取实时统计失败');
    }
  }

  /**
   * 生成统计报表
   */
  static async generateReport(req, res) {
    try {
      const { start_date, end_date, group_id, format = 'json' } = req.query;
      
      const report = await StatsService.generateReport({
        startDate: start_date,
        endDate: end_date,
        groupId: group_id,
        format
      });

      return ResponseHelper.success(res, report, '统计报表生成成功');
    } catch (error) {
      logger.error('生成统计报表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '生成统计报表失败');
    }
  }
}

module.exports = SystemStatsController;
