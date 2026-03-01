/**
 * 使用记录服务 - 处理用户使用情况和积分消费记录
 */

const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError } = require('../../utils/errors');
const XLSX = require('xlsx');

class UsageLogService {
  /**
   * 获取使用记录列表
   */
  static async getUsageLogs(options = {}) {
    try {
      const {
        page = 1,
        pageSize = 20,
        searchTerm = '',
        userId = null,
        groupId = null,
        modelName = null,
        startDate = null,
        endDate = null,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;

      // 构建查询条件
      let whereConditions = ['ct.transaction_type = ?'];
      let queryParams = ['chat_consume'];

      if (searchTerm) {
        whereConditions.push('(u.username LIKE ? OR u.email LIKE ?)');
        queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
      }

      if (userId) {
        whereConditions.push('ct.user_id = ?');
        queryParams.push(userId);
      }

      if (groupId) {
        whereConditions.push('u.group_id = ?');
        queryParams.push(groupId);
      }

      if (modelName) {
        whereConditions.push('c.model_name = ?');
        queryParams.push(modelName);
      }

      if (startDate) {
        whereConditions.push('ct.created_at >= ?');
        queryParams.push(startDate);
      }

      if (endDate) {
        whereConditions.push('ct.created_at <= ?');
        queryParams.push(endDate);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';

      // 获取总数
      const countSql = `
        SELECT COUNT(*) as total
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN user_groups g ON u.group_id = g.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        ${whereClause}
      `;

      const { rows: countRows } = await dbConnection.query(countSql, queryParams);
      const total = countRows[0].total;

      // 获取分页数据 - 将LIMIT和OFFSET直接拼接到SQL中
      const offset = (page - 1) * pageSize;
      
      // 固定使用 ct.created_at 排序
      const dataSql = `
        SELECT 
          ct.id,
          ct.created_at as usage_time,
          ct.user_id,
          u.username,
          u.email,
          u.group_id,
          g.name as group_name,
          g.color as group_color,
          ct.amount as credits_consumed,
          ct.balance_after,
          ct.related_conversation_id,
          c.title as conversation_title,
          c.model_name,
          am.display_name as model_display_name,
          am.provider as model_provider,
          ct.description,
          ct.request_id,
          CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as conversation_exists
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN user_groups g ON u.group_id = g.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        LEFT JOIN ai_models am ON c.model_name = am.name
        ${whereClause}
        ORDER BY ct.created_at DESC
        LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}
      `;
      
      const { rows } = await dbConnection.query(dataSql, queryParams);

      // 处理数据，确保积分消费为正数
      const processedRows = rows.map(row => ({
        ...row,
        credits_consumed: Math.abs(row.credits_consumed)
      }));

      return {
        list: processedRows,
        pagination: {
          current: page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      };
    } catch (error) {
      logger.error('获取使用记录失败:', error);
      throw new DatabaseError('获取使用记录失败', error);
    }
  }

  /**
   * 获取使用统计汇总
   */
  static async getUsageSummary(options = {}) {
    try {
      const {
        startDate = null,
        endDate = null,
        groupId = null
      } = options;

      let whereConditions = ['ct.transaction_type = ?'];
      let queryParams = ['chat_consume'];

      if (startDate) {
        whereConditions.push('ct.created_at >= ?');
        queryParams.push(startDate);
      }

      if (endDate) {
        whereConditions.push('ct.created_at <= ?');
        queryParams.push(endDate);
      }

      if (groupId) {
        whereConditions.push('u.group_id = ?');
        queryParams.push(groupId);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';

      // 获取汇总统计
      const summarySql = `
        SELECT 
          COUNT(DISTINCT ct.user_id) as unique_users,
          COUNT(*) as total_transactions,
          SUM(ABS(ct.amount)) as total_credits_consumed,
          AVG(ABS(ct.amount)) as avg_credits_per_use,
          COUNT(DISTINCT DATE(ct.created_at)) as active_days,
          COUNT(DISTINCT c.model_name) as models_used
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        ${whereClause}
      `;

      const { rows: summaryRows } = await dbConnection.query(summarySql, queryParams);

      // 获取按日期的消费趋势
      const trendSql = `
        SELECT 
          DATE(ct.created_at) as date,
          COUNT(*) as transactions,
          SUM(ABS(ct.amount)) as credits_consumed,
          COUNT(DISTINCT ct.user_id) as unique_users
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        ${whereClause}
        GROUP BY DATE(ct.created_at)
        ORDER BY date DESC
        LIMIT 30
      `;

      const { rows: trendRows } = await dbConnection.query(trendSql, queryParams);

      // 获取TOP用户
      const topUsersSql = `
        SELECT 
          ct.user_id,
          u.username,
          u.email,
          g.name as group_name,
          COUNT(*) as usage_count,
          SUM(ABS(ct.amount)) as total_credits
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN user_groups g ON u.group_id = g.id
        ${whereClause}
        GROUP BY ct.user_id, u.username, u.email, g.name
        ORDER BY total_credits DESC
        LIMIT 10
      `;

      const { rows: topUsers } = await dbConnection.query(topUsersSql, queryParams);

      // 获取模型使用分布
      const modelDistributionSql = `
        SELECT 
          c.model_name,
          am.display_name,
          am.provider,
          COUNT(*) as usage_count,
          SUM(ABS(ct.amount)) as total_credits
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        LEFT JOIN ai_models am ON c.model_name = am.name
        ${whereClause}
        GROUP BY c.model_name, am.display_name, am.provider
        ORDER BY usage_count DESC
      `;

      const { rows: modelDistribution } = await dbConnection.query(modelDistributionSql, queryParams);

      return {
        summary: summaryRows[0] || {},
        trend: trendRows,
        topUsers,
        modelDistribution
      };
    } catch (error) {
      logger.error('获取使用统计汇总失败:', error);
      throw new DatabaseError('获取使用统计汇总失败', error);
    }
  }

  /**
   * 导出使用记录为Excel
   */
  static async exportToExcel(options = {}) {
    try {
      // 获取所有记录（不分页）
      const allOptions = {
        ...options,
        page: 1,
        pageSize: 100000 // 设置一个大数字获取所有记录
      };

      const { list } = await UsageLogService.getUsageLogs(allOptions);

      // 准备Excel数据
      const excelData = list.map(record => ({
        '使用时间': record.usage_time,
        '用户名': record.username,
        '邮箱': record.email,
        '所属组': record.group_name || '-',
        '使用模型': record.model_display_name || record.model_name || '-',
        '模型提供商': record.model_provider || '-',
        '消耗积分': record.credits_consumed,
        '剩余积分': record.balance_after,
        '会话标题': record.conversation_title || '-',
        '描述': record.description || '-'
      }));

      // 创建工作簿
      const wb = XLSX.utils.book_new();
      
      // 创建工作表
      const ws = XLSX.utils.json_to_sheet(excelData);
      
      // 设置列宽
      const colWidths = [
        { wch: 20 }, // 使用时间
        { wch: 15 }, // 用户名
        { wch: 25 }, // 邮箱
        { wch: 15 }, // 所属组
        { wch: 20 }, // 使用模型
        { wch: 15 }, // 模型提供商
        { wch: 10 }, // 消耗积分
        { wch: 10 }, // 剩余积分
        { wch: 30 }, // 会话标题
        { wch: 40 }  // 描述
      ];
      ws['!cols'] = colWidths;

      // 添加工作表到工作簿
      XLSX.utils.book_append_sheet(wb, ws, '使用记录');

      // 如果有汇总数据，添加汇总表
      const summary = await UsageLogService.getUsageSummary(options);
      if (summary) {
        // 创建汇总数据
        const summaryData = [
          { '统计项': '独立用户数', '数值': summary.summary.unique_users || 0 },
          { '统计项': '总使用次数', '数值': summary.summary.total_transactions || 0 },
          { '统计项': '总消耗积分', '数值': summary.summary.total_credits_consumed || 0 },
          { '统计项': '平均每次消耗', '数值': Math.round(summary.summary.avg_credits_per_use || 0) },
          { '统计项': '活跃天数', '数值': summary.summary.active_days || 0 },
          { '统计项': '使用模型数', '数值': summary.summary.models_used || 0 }
        ];

        const summaryWs = XLSX.utils.json_to_sheet(summaryData);
        summaryWs['!cols'] = [{ wch: 20 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, '汇总统计');

        // 添加TOP用户表
        if (summary.topUsers && summary.topUsers.length > 0) {
          const topUsersData = summary.topUsers.map((user, index) => ({
            '排名': index + 1,
            '用户名': user.username,
            '邮箱': user.email,
            '所属组': user.group_name || '-',
            '使用次数': user.usage_count,
            '消耗积分': user.total_credits
          }));

          const topUsersWs = XLSX.utils.json_to_sheet(topUsersData);
          topUsersWs['!cols'] = [
            { wch: 8 },
            { wch: 15 },
            { wch: 25 },
            { wch: 15 },
            { wch: 10 },
            { wch: 10 }
          ];
          XLSX.utils.book_append_sheet(wb, topUsersWs, 'TOP用户');
        }
      }

      // 生成Excel文件Buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      return buffer;
    } catch (error) {
      logger.error('导出Excel失败:', error);
      throw new Error('导出Excel失败');
    }
  }
}

module.exports = UsageLogService;
