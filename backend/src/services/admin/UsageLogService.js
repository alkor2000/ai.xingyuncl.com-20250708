/**
 * 使用记录服务 - 处理用户使用情况和积分消费记录
 * 
 * v1.1 - 新增 getCreditsChart 积分消耗柱状图数据
 * v1.2 - 修复时间格式：MySQL DATE() 改用 DATE_FORMAT 返回纯字符串
 * v1.3 - 修复Excel导出时间列：usage_time格式化为YYYY-MM-DD HH:mm:ss字符串
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
        page = 1, pageSize = 20, searchTerm = '', userId = null,
        groupId = null, modelName = null, startDate = null, endDate = null,
        sortBy = 'created_at', sortOrder = 'DESC'
      } = options;

      let whereConditions = ['ct.transaction_type = ?'];
      let queryParams = ['chat_consume'];

      if (searchTerm) {
        whereConditions.push('(u.username LIKE ? OR u.email LIKE ?)');
        queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
      }
      if (userId) { whereConditions.push('ct.user_id = ?'); queryParams.push(userId); }
      if (groupId) { whereConditions.push('u.group_id = ?'); queryParams.push(groupId); }
      if (modelName) { whereConditions.push('c.model_name = ?'); queryParams.push(modelName); }
      if (startDate) { whereConditions.push('ct.created_at >= ?'); queryParams.push(startDate); }
      if (endDate) { whereConditions.push('ct.created_at <= ?'); queryParams.push(endDate); }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}` : '';

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

      const offset = (page - 1) * pageSize;
      const dataSql = `
        SELECT 
          ct.id, ct.created_at as usage_time, ct.user_id,
          u.username, u.email, u.group_id,
          g.name as group_name, g.color as group_color,
          ct.amount as credits_consumed, ct.balance_after,
          ct.related_conversation_id, c.title as conversation_title,
          c.model_name, am.display_name as model_display_name,
          am.provider as model_provider, ct.description, ct.request_id,
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

      const processedRows = rows.map(row => ({
        ...row,
        credits_consumed: Math.abs(row.credits_consumed)
      }));

      return {
        list: processedRows,
        pagination: { current: page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
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
      const { startDate = null, endDate = null, groupId = null } = options;

      let whereConditions = ['ct.transaction_type = ?'];
      let queryParams = ['chat_consume'];

      if (startDate) { whereConditions.push('ct.created_at >= ?'); queryParams.push(startDate); }
      if (endDate) { whereConditions.push('ct.created_at <= ?'); queryParams.push(endDate); }
      if (groupId) { whereConditions.push('u.group_id = ?'); queryParams.push(groupId); }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const summarySql = `
        SELECT 
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

      const modelDistributionSql = `
        SELECT 
          c.model_name, am.display_name, am.provider,
          COUNT(*) as usage_count, SUM(ABS(ct.amount)) as total_credits
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        LEFT JOIN ai_models am ON c.model_name = am.name
        ${whereClause}
        GROUP BY c.model_name, am.display_name, am.provider
        ORDER BY usage_count DESC
      `;
      const { rows: modelDistribution } = await dbConnection.query(modelDistributionSql, queryParams);

      return { summary: summaryRows[0] || {}, modelDistribution };
    } catch (error) {
      logger.error('获取使用统计汇总失败:', error);
      throw new DatabaseError('获取使用统计汇总失败', error);
    }
  }

  /**
   * v1.1/v1.2: 获取积分消耗柱状图数据
   */
  static async getCreditsChart(options = {}) {
    try {
      const { granularity = 'day', startDate = null, endDate = null, groupId = null } = options;

      /* 统一使用 DATE_FORMAT 返回纯字符串 */
      let timeExpr;
      switch (granularity) {
        case 'hour':
          timeExpr = "DATE_FORMAT(ct.created_at, '%m-%d %H:00')";
          break;
        case 'week':
          timeExpr = "DATE_FORMAT(DATE_SUB(ct.created_at, INTERVAL WEEKDAY(ct.created_at) DAY), '%m-%d')";
          break;
        case 'month':
          timeExpr = "DATE_FORMAT(ct.created_at, '%Y-%m')";
          break;
        default:
          timeExpr = "DATE_FORMAT(ct.created_at, '%m-%d')";
          break;
      }

      let whereConditions = ['ct.transaction_type = ?'];
      let queryParams = ['chat_consume'];

      if (startDate) { whereConditions.push('ct.created_at >= ?'); queryParams.push(startDate); }
      if (endDate) { whereConditions.push('ct.created_at <= ?'); queryParams.push(`${endDate} 23:59:59`); }
      if (groupId) { whereConditions.push('u.group_id = ?'); queryParams.push(groupId); }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

      if (!groupId) {
        /* 模式A: 未选组 → 按组聚合 */
        const sql = `
          SELECT 
            ${timeExpr} as time_bucket,
            COALESCE(g.name, '未分组') as segment_name,
            COALESCE(g.id, 0) as segment_id,
            SUM(ABS(ct.amount)) as credits
          FROM credit_transactions ct
          LEFT JOIN users u ON ct.user_id = u.id
          LEFT JOIN user_groups g ON u.group_id = g.id
          ${whereClause}
          GROUP BY time_bucket, segment_name, segment_id
          ORDER BY time_bucket ASC, credits DESC
        `;
        const { rows } = await dbConnection.query(sql, queryParams);
        return UsageLogService._buildChartData(rows, 'group');

      } else {
        /* 模式B: 选组 → 按用户TOP20聚合 */
        const topUsersSql = `
          SELECT ct.user_id, u.username, SUM(ABS(ct.amount)) as total_credits
          FROM credit_transactions ct
          LEFT JOIN users u ON ct.user_id = u.id
          ${whereClause}
          GROUP BY ct.user_id, u.username
          ORDER BY total_credits DESC
          LIMIT 20
        `;
        const { rows: topUsers } = await dbConnection.query(topUsersSql, queryParams);
        const topUserIds = topUsers.map(u => u.user_id);

        const sql = `
          SELECT 
            ${timeExpr} as time_bucket,
            CASE 
              WHEN ct.user_id IN (${topUserIds.length > 0 ? topUserIds.join(',') : '0'})
              THEN u.username ELSE '其他'
            END as segment_name,
            CASE 
              WHEN ct.user_id IN (${topUserIds.length > 0 ? topUserIds.join(',') : '0'})
              THEN ct.user_id ELSE 0
            END as segment_id,
            SUM(ABS(ct.amount)) as credits
          FROM credit_transactions ct
          LEFT JOIN users u ON ct.user_id = u.id
          ${whereClause}
          GROUP BY time_bucket, segment_name, segment_id
          ORDER BY time_bucket ASC, credits DESC
        `;
        const { rows } = await dbConnection.query(sql, queryParams);
        return UsageLogService._buildChartData(rows, 'user');
      }

    } catch (error) {
      logger.error('获取积分消耗柱状图数据失败:', error);
      throw new DatabaseError('获取图表数据失败', error);
    }
  }

  /**
   * SQL结果 → ECharts格式
   * @private
   */
  static _buildChartData(rows, mode) {
    const timeLabelSet = new Set();
    rows.forEach(r => timeLabelSet.add(String(r.time_bucket)));
    const timeLabels = Array.from(timeLabelSet).sort((a, b) => a.localeCompare(b));

    const segmentTotals = {};
    rows.forEach(r => {
      const name = r.segment_name || '未知';
      segmentTotals[name] = (segmentTotals[name] || 0) + Number(r.credits || 0);
    });
    const segmentNames = Object.keys(segmentTotals)
      .sort((a, b) => segmentTotals[b] - segmentTotals[a]);

    const series = segmentNames.map(name => {
      const dataMap = {};
      rows.forEach(r => {
        if ((r.segment_name || '未知') === name) {
          dataMap[String(r.time_bucket)] = Number(r.credits || 0);
        }
      });
      return { name, data: timeLabels.map(t => dataMap[t] || 0) };
    });

    return { timeLabels, series, mode };
  }

  /**
   * 格式化日期为 YYYY-MM-DD HH:mm:ss 字符串
   * v1.3新增：确保Excel中时间列显示完整时间戳
   * @param {Date|string} date - 日期对象或字符串
   * @returns {string} 格式化后的字符串
   * @private
   */
  static _formatDateTime(date) {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 导出使用记录为Excel
   * v1.3修复：usage_time格式化为字符串，确保Excel中显示完整时间戳
   */
  static async exportToExcel(options = {}) {
    try {
      const allOptions = { ...options, page: 1, pageSize: 100000 };
      const { list } = await UsageLogService.getUsageLogs(allOptions);

      /* v1.3: 时间格式化为字符串，避免Excel自动截断 */
      const excelData = list.map(record => ({
        '使用时间': UsageLogService._formatDateTime(record.usage_time),
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

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      
      /* v1.3: 加宽时间列 20→24 */
      ws['!cols'] = [
        { wch: 24 }, { wch: 15 }, { wch: 25 }, { wch: 15 },
        { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 10 },
        { wch: 30 }, { wch: 40 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, '使用记录');

      const summary = await UsageLogService.getUsageSummary(options);
      if (summary) {
        const summaryData = [
          { '统计项': '总使用次数', '数值': summary.summary.total_transactions || 0 },
          { '统计项': '总消耗积分', '数值': summary.summary.total_credits_consumed || 0 },
          { '统计项': '平均每次消耗', '数值': Math.round(summary.summary.avg_credits_per_use || 0) },
          { '统计项': '活跃天数', '数值': summary.summary.active_days || 0 },
          { '统计项': '使用模型数', '数值': summary.summary.models_used || 0 }
        ];
        const summaryWs = XLSX.utils.json_to_sheet(summaryData);
        summaryWs['!cols'] = [{ wch: 20 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, '汇总统计');
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      logger.error('导出Excel失败:', error);
      throw new Error('导出Excel失败');
    }
  }
}

module.exports = UsageLogService;
