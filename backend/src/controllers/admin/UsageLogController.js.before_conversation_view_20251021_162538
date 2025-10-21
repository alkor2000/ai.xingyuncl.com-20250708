/**
 * 使用记录控制器
 */

const UsageLogService = require('../../services/admin/UsageLogService');
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
}

module.exports = UsageLogController;
