/**
 * 使用记录控制器
 * 
 * 更新记录：
 * - v1.1 (2025-01-XX): 新增组管理员查看对话记录权限控制
 *   * 组管理员需要 can_view_chat_history = 1 才能查看组员对话记录
 *   * 超级管理员不受此限制
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

      // 组管理员只能查看本组数据
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

      // 组管理员只能查看本组数据
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
   * 导出使用记录为Excel
   */
  static async exportUsageLogs(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以导出
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以导出数据');
      }

      const {
        search,
        userId,
        groupId,
        modelName,
        startDate,
        endDate
      } = req.query;

      const options = {
        searchTerm: search,
        userId: userId ? parseInt(userId) : null,
        groupId: groupId ? parseInt(groupId) : null,
        modelName,
        startDate,
        endDate
      };

      const buffer = await UsageLogService.exportToExcel(options);

      // 设置响应头
      const filename = `usage_logs_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);

      // 发送文件
      res.send(buffer);

      logger.info('导出使用记录成功', {
        adminId: req.user.id,
        filename,
        options
      });
    } catch (error) {
      logger.error('导出使用记录失败:', error);
      return ResponseHelper.error(res, error.message || '导出失败');
    }
  }

  /**
   * 获取会话的完整消息记录（管理员专用）
   * GET /api/admin/conversations/:conversationId/messages
   * 
   * 权限控制：
   * - 超级管理员：可以查看所有人的对话记录
   * - 组管理员：需要 can_view_chat_history = 1 才能查看本组用户的对话记录
   * 
   * v1.1更新：新增 can_view_chat_history 权限检查
   */
  static async getConversationMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const userRole = req.user.role;

      // 权限检查：只有管理员和超级管理员可以访问
      if (userRole !== ROLES.ADMIN && userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有管理员可以查看对话记录');
      }

      // 验证会话是否存在
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return ResponseHelper.notFound(res, '会话不存在');
      }

      // 组管理员特殊权限检查
      if (userRole === ROLES.ADMIN) {
        // v1.1新增：检查组管理员是否有查看对话记录的权限
        if (!req.user.can_view_chat_history) {
          logger.warn('组管理员尝试查看对话记录但没有权限', {
            adminId: req.user.id,
            adminUsername: req.user.username,
            conversationId,
            can_view_chat_history: req.user.can_view_chat_history
          });
          return ResponseHelper.forbidden(res, '您没有查看对话记录的权限');
        }

        // 需要验证会话所属用户是否在当前管理员的组
        const dbConnection = require('../../database/connection');
        const checkSql = `
          SELECT u.group_id 
          FROM conversations c
          JOIN users u ON c.user_id = u.id
          WHERE c.id = ?
        `;
        const { rows } = await dbConnection.query(checkSql, [conversationId]);
        
        if (rows.length === 0 || rows[0].group_id !== req.user.group_id) {
          return ResponseHelper.forbidden(res, '无权查看其他组的对话记录');
        }
      }

      // 获取会话的所有消息（不分页，全部返回）
      const result = await Message.getConversationMessages(conversationId, {
        page: 1,
        limit: 10000, // 设置一个大数字获取所有消息
        order: 'DESC', // 倒序：最新的在前
        includeStreaming: false // 不包含流式传输中的消息
      });

      // 返回会话信息和消息列表
      const responseData = {
        conversation: conversation.toJSON(),
        messages: result.messages.map(msg => msg.toJSON())
      };

      logger.info('管理员查看会话消息', {
        adminId: req.user.id,
        adminRole: userRole,
        conversationId,
        messageCount: result.messages.length,
        can_view_chat_history: req.user.can_view_chat_history
      });

      return ResponseHelper.success(res, responseData, '获取对话记录成功');
    } catch (error) {
      logger.error('获取会话消息失败:', error);
      return ResponseHelper.error(res, error.message || '获取对话记录失败');
    }
  }

  /**
   * 检查当前用户是否有查看对话记录的权限
   * GET /api/admin/usage-logs/can-view-chat
   * 
   * 用于前端判断是否显示"查看"按钮
   */
  static async checkCanViewChat(req, res) {
    try {
      const userRole = req.user.role;

      // 超级管理员始终可以查看
      if (userRole === ROLES.SUPER_ADMIN) {
        return ResponseHelper.success(res, { 
          canView: true,
          reason: '超级管理员'
        }, '权限检查成功');
      }

      // 组管理员检查 can_view_chat_history 字段
      if (userRole === ROLES.ADMIN) {
        const canView = req.user.can_view_chat_history === 1 || 
                        req.user.can_view_chat_history === true;
        return ResponseHelper.success(res, { 
          canView,
          reason: canView ? '已授权查看' : '未授权查看'
        }, '权限检查成功');
      }

      // 普通用户不能查看
      return ResponseHelper.success(res, { 
        canView: false,
        reason: '无权限'
      }, '权限检查成功');
    } catch (error) {
      logger.error('检查查看对话权限失败:', error);
      return ResponseHelper.error(res, error.message || '权限检查失败');
    }
  }
}

module.exports = UsageLogController;
