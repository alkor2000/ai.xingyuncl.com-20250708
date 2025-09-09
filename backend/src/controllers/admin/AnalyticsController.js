/**
 * 数据分析控制器 - 处理BI面板相关请求
 */

const AnalyticsService = require('../../services/admin/AnalyticsService');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const { ROLES } = require('../../middleware/permissions');
const moment = require('moment');

class AnalyticsController {
  /**
   * 获取综合分析数据
   */
  static async getAnalytics(req, res) {
    try {
      const userRole = req.user.role;
      const {
        startDate,
        endDate,
        groupId,
        tagIds,
        timeGranularity = 'day'
      } = req.query;

      // 组管理员只能查看本组数据
      let actualGroupId = groupId;
      if (userRole === ROLES.ADMIN) {
        actualGroupId = req.user.group_id;
      }

      // 构建查询选项
      const options = {
        startDate,
        endDate,
        groupId: actualGroupId ? parseInt(actualGroupId) : null,
        tagIds: tagIds ? tagIds.split(',').map(id => parseInt(id)) : [],
        timeGranularity
      };

      // 获取分析数据
      const analyticsData = await AnalyticsService.getComprehensiveAnalytics(options);

      // 记录访问日志
      logger.info('获取数据分析', {
        userId: req.user.id,
        userRole,
        options
      });

      return ResponseHelper.success(res, analyticsData, '获取分析数据成功');
    } catch (error) {
      logger.error('获取分析数据失败:', error);
      return ResponseHelper.error(res, error.message || '获取分析数据失败');
    }
  }

  /**
   * 导出分析报表
   */
  static async exportAnalytics(req, res) {
    try {
      const userRole = req.user.role;
      const {
        startDate,
        endDate,
        groupId,
        tagIds,
        timeGranularity = 'day'
      } = req.query;

      // 组管理员只能导出本组数据
      let actualGroupId = groupId;
      if (userRole === ROLES.ADMIN) {
        actualGroupId = req.user.group_id;
      }

      // 构建查询选项
      const options = {
        startDate,
        endDate,
        groupId: actualGroupId ? parseInt(actualGroupId) : null,
        tagIds: tagIds ? tagIds.split(',').map(id => parseInt(id)) : [],
        timeGranularity
      };

      // 获取分析数据
      const analyticsData = await AnalyticsService.getComprehensiveAnalytics(options);

      // 生成Excel文件
      const buffer = await AnalyticsService.exportAnalyticsToExcel(analyticsData);

      // 设置响应头
      const filename = `analytics_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);

      // 发送文件
      res.send(buffer);

      logger.info('导出分析报表成功', {
        userId: req.user.id,
        userRole,
        filename,
        options
      });
    } catch (error) {
      logger.error('导出分析报表失败:', error);
      return ResponseHelper.error(res, error.message || '导出失败');
    }
  }

  /**
   * 获取实时数据看板
   * 修复：避免并发查询导致的MySQL连接问题
   */
  static async getDashboard(req, res) {
    try {
      const userRole = req.user.role;
      
      // 组管理员只能看本组数据
      const groupId = userRole === ROLES.ADMIN ? req.user.group_id : null;

      // 计算日期范围
      const today = moment().format('YYYY-MM-DD');
      const startOfWeek = moment().startOf('week').format('YYYY-MM-DD');
      const startOfMonth = moment().startOf('month').format('YYYY-MM-DD');

      // 修复：使用串行查询代替并发查询，避免MySQL连接问题
      let todayData = null;
      let weekData = null;
      let monthData = null;

      try {
        // 获取今日数据
        todayData = await AnalyticsService.getComprehensiveAnalytics({
          startDate: today,
          endDate: today,
          groupId,
          timeGranularity: 'day'
        });
      } catch (error) {
        logger.error('获取今日数据失败:', error);
        todayData = { overview: {} };
      }

      try {
        // 获取本周数据
        weekData = await AnalyticsService.getComprehensiveAnalytics({
          startDate: startOfWeek,
          endDate: today,
          groupId,
          timeGranularity: 'day'
        });
      } catch (error) {
        logger.error('获取本周数据失败:', error);
        weekData = { overview: {} };
      }

      try {
        // 获取本月数据
        monthData = await AnalyticsService.getComprehensiveAnalytics({
          startDate: startOfMonth,
          endDate: today,
          groupId,
          timeGranularity: 'day'
        });
      } catch (error) {
        logger.error('获取本月数据失败:', error);
        monthData = { overview: {} };
      }

      // 构建看板数据
      const dashboard = {
        today: {
          credits: todayData.overview.total_credits_consumed || 0,
          users: todayData.overview.total_users || 0,
          conversations: todayData.overview.total_conversations || 0,
          messages: todayData.overview.total_messages || 0
        },
        week: {
          credits: weekData.overview.total_credits_consumed || 0,
          users: weekData.overview.total_users || 0,
          conversations: weekData.overview.total_conversations || 0,
          messages: weekData.overview.total_messages || 0
        },
        month: {
          credits: monthData.overview.total_credits_consumed || 0,
          users: monthData.overview.total_users || 0,
          conversations: monthData.overview.total_conversations || 0,
          messages: monthData.overview.total_messages || 0
        },
        // 添加时间序列数据（如果有）
        timeSeries: monthData.timeSeries || [],
        // 添加TOP用户数据（如果有）
        topUsers: monthData.users?.topUsers || [],
        // 添加模型使用数据（如果有）
        modelUsage: monthData.models?.chatModels || [],
        timestamp: new Date().toISOString()
      };

      return ResponseHelper.success(res, dashboard, '获取实时看板成功');
    } catch (error) {
      logger.error('获取实时看板失败:', error);
      // 返回空数据而不是错误，确保前端不会报错
      const emptyDashboard = {
        today: {
          credits: 0,
          users: 0,
          conversations: 0,
          messages: 0
        },
        week: {
          credits: 0,
          users: 0,
          conversations: 0,
          messages: 0
        },
        month: {
          credits: 0,
          users: 0,
          conversations: 0,
          messages: 0
        },
        timeSeries: [],
        topUsers: [],
        modelUsage: [],
        timestamp: new Date().toISOString()
      };
      return ResponseHelper.success(res, emptyDashboard, '获取实时看板成功（使用默认值）');
    }
  }
}

module.exports = AnalyticsController;
