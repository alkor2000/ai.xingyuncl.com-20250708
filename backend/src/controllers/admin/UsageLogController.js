/**
 * 使用记录控制器
 * 
 * v1.1 - 组管理员查看对话记录权限控制
 * v1.2 - 新增 getCreditsChart 积分消耗柱状图API
 */

const UsageLogService = require('../../services/admin/UsageLogService');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const { ROLES } = require('../../middleware/permissions');

class UsageLogController {
  /**
   * 获取使用记录列表
   */
  static async getUsageLogs(req, res) {
    try {
      const userRole = req.user.role;
      const {
        page = 1,
        pageSize = 20,
        search,
        userId,
        groupId,
        modelName,
        startDate,
        endDate,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = req.query;

      /* 组管理员只能查看本组数据 */
      let actualGroupId = groupId;
      if (userRole === ROLES.ADMIN) {
        actualGroupId = req.user.group_id;
      }

      const options = {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        searchTerm: search,
        userId: userId ? parseInt(userId) : null,
        groupId: actualGroupId ? parseInt(actualGroupId) : null,
        modelName,
        startDate,
        endDate,
        sortBy,
        sortOrder
      };

      const result = await UsageLogService.getUsageLogs(options);

      return ResponseHelper.success(res, result, '获取使用记录成功');
    } catch (error) {
      logger.error('获取使用记录失败:', error);
      return ResponseHelper.error(res, error.message || '获取使用记录失败');
    }
  }

  /**
   * 获取使用统计汇总
   */
  static async getUsageSummary(req, res) {
    try {
      const userRole = req.user.role;
      const { startDate, endDate, groupId } = req.query;

      let actualGroupId = groupId;
      if (userRole === ROLES.ADMIN) {
        actualGroupId = req.user.group_id;
      }

      const options = {
        startDate,
        endDate,
        groupId: actualGroupId ? parseInt(actualGroupId) : null
      };

      const result = await UsageLogService.getUsageSummary(options);

      return ResponseHelper.success(res, result, '获取使用统计成功');
    } catch (error) {
      logger.error('获取使用统计失败:', error);
      return ResponseHelper.error(res, error.message || '获取使用统计失败');
    }
  }

  /**
   * v1.2 新增：获取积分消耗柱状图数据
   * 
   * 查询参数：
   * - granularity: 时间粒度 hour/day/week/month（默认day）
   * - startDate: 开始日期
   * - endDate: 结束日期
   * - groupId: 组ID（可选，超管可选任意组）
   */
  static async getCreditsChart(req, res) {
    try {
      const userRole = req.user.role;
      const { granularity = 'day', startDate, endDate, groupId } = req.query;

      /* 组管理员强制使用本组ID */
      let actualGroupId = groupId ? parseInt(groupId) : null;
      if (userRole === ROLES.ADMIN) {
        actualGroupId = req.user.group_id;
      }

      /* 验证粒度参数 */
      const validGranularities = ['hour', 'day', 'week', 'month'];
      if (!validGranularities.includes(granularity)) {
        return ResponseHelper.validation(res, null, '无效的时间粒度，支持: hour/day/week/month');
      }

      const options = {
        granularity,
        startDate,
        endDate,
        groupId: actualGroupId
      };

      const result = await UsageLogService.getCreditsChart(options);

      return ResponseHelper.success(res, result, '获取图表数据成功');
    } catch (error) {
      logger.error('获取积分消耗柱状图失败:', error);
      return ResponseHelper.error(res, error.message || '获取图表数据失败');
    }
  }

  /**
   * 导出使用记录为Excel
   */
  static async exportUsageLogs(req, res) {
    try {
      const userRole = req.user.role;
      
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以导出数据');
      }

      const { search, userId, groupId, modelName, startDate, endDate } = req.query;

      const options = {
        searchTerm: search,
        userId: userId ? parseInt(userId) : null,
        groupId: groupId ? parseInt(groupId) : null,
        modelName,
        startDate,
        endDate
      };

      const buffer = await UsageLogService.exportToExcel(options);

      const filename = `usage_logs_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);

      logger.info('导出使用记录成功', { adminId: req.user.id, filename, options });
    } catch (error) {
      logger.error('导出使用记录失败:', error);
      return ResponseHelper.error(res, error.message || '导出失败');
    }
  }

  /**
   * 获取会话的完整消息记录（管理员专用）
   */
  static async getConversationMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const userRole = req.user.role;

      if (userRole !== ROLES.ADMIN && userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有管理员可以查看对话记录');
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      if (userRole === ROLES.ADMIN) {
        if (!req.user.can_view_chat_history) {
          logger.warn('组管理员尝试查看对话记录但没有权限', {
            adminId: req.user.id, conversationId
          });
          return ResponseHelper.forbidden(res, '您没有查看对话记录的权限');
        }

        const dbConn = require('../../database/connection');
        const checkSql = `
          SELECT u.group_id FROM conversations c
          JOIN users u ON c.user_id = u.id WHERE c.id = ?
        `;
        const { rows } = await dbConn.query(checkSql, [conversationId]);
        
        if (rows.length === 0 || rows[0].group_id !== req.user.group_id) {
          return ResponseHelper.forbidden(res, '无权查看其他组的对话记录');
        }
      }

      const result = await Message.getConversationMessages(conversationId, {
        page: 1, limit: 10000, order: 'DESC', includeStreaming: false
      });

      const responseData = {
        conversation: conversation.toJSON(),
        messages: result.messages.map(msg => msg.toJSON())
      };

      logger.info('管理员查看会话消息', {
        adminId: req.user.id, adminRole: userRole, conversationId,
        messageCount: result.messages.length
      });

      return ResponseHelper.success(res, responseData, '获取对话记录成功');
    } catch (error) {
      logger.error('获取会话消息失败:', error);
      return ResponseHelper.error(res, error.message || '获取对话记录失败');
    }
  }

  /**
   * 检查当前用户是否有查看对话记录的权限
   */
  static async checkCanViewChat(req, res) {
    try {
      const userRole = req.user.role;

      if (userRole === ROLES.SUPER_ADMIN) {
        return ResponseHelper.success(res, { canView: true, reason: '超级管理员' });
      }

      if (userRole === ROLES.ADMIN) {
        const canView = req.user.can_view_chat_history === 1 || 
                        req.user.can_view_chat_history === true;
        return ResponseHelper.success(res, { canView, reason: canView ? '已授权查看' : '未授权查看' });
      }

      return ResponseHelper.success(res, { canView: false, reason: '无权限' });
    } catch (error) {
      logger.error('检查查看对话权限失败:', error);
      return ResponseHelper.error(res, error.message || '权限检查失败');
    }
  }
}

module.exports = UsageLogController;
