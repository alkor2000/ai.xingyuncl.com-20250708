/**
 * 数据分析服务 - 提供多维度的数据分析和BI统计
 */

const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError } = require('../../utils/errors');
const XLSX = require('xlsx');
const moment = require('moment');

class AnalyticsService {
  /**
   * 获取综合分析数据
   * @param {Object} options - 查询选项
   * @param {Date} options.startDate - 开始日期
   * @param {Date} options.endDate - 结束日期
   * @param {Number} options.groupId - 组ID（组管理员必传）
   * @param {Array} options.tagIds - 标签ID列表
   * @param {String} options.timeGranularity - 时间粒度：day/week/month
   */
  static async getComprehensiveAnalytics(options = {}) {
    try {
      const {
        startDate,
        endDate,
        groupId,
        tagIds = [],
        timeGranularity = 'day'
      } = options;

      // 构建基础查询条件
      const baseConditions = [];
      const params = [];

      if (startDate) {
        baseConditions.push('DATE(ct.created_at) >= ?');
        params.push(moment(startDate).format('YYYY-MM-DD'));
      }

      if (endDate) {
        baseConditions.push('DATE(ct.created_at) <= ?');
        params.push(moment(endDate).format('YYYY-MM-DD'));
      }

      if (groupId) {
        baseConditions.push('u.group_id = ?');
        params.push(groupId);
      }

      const whereClause = baseConditions.length > 0 
        ? `WHERE ${baseConditions.join(' AND ')}` 
        : '';

      // 获取各个维度的分析数据
      const [
        overviewData,
        timeSeriesData,
        userAnalysis,
        modelAnalysis,
        moduleAnalysis,
        tagAnalysis
      ] = await Promise.all([
        this.getOverviewAnalytics(whereClause, params),
        this.getTimeSeriesAnalytics(whereClause, params, timeGranularity),
        this.getUserAnalytics(whereClause, params, tagIds),
        this.getModelAnalytics(whereClause, params),
        this.getModuleAnalytics(whereClause, params),
        this.getTagAnalytics(groupId)
      ]);

      return {
        overview: overviewData,
        timeSeries: timeSeriesData,
        users: userAnalysis,
        models: modelAnalysis,
        modules: moduleAnalysis,
        tags: tagAnalysis,
        metadata: {
          startDate,
          endDate,
          groupId,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('获取综合分析数据失败:', error);
      throw new DatabaseError('获取分析数据失败', error);
    }
  }

  /**
   * 获取概览分析数据
   */
  static async getOverviewAnalytics(whereClause, params) {
    try {
      const sql = `
        SELECT 
          COUNT(DISTINCT u.id) as total_users,
          COUNT(DISTINCT CASE WHEN DATE(u.last_login_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN u.id END) as active_users_7d,
          COUNT(DISTINCT CASE WHEN DATE(u.last_login_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN u.id END) as active_users_30d,
          COUNT(DISTINCT c.id) as total_conversations,
          SUM(c.message_count) as total_messages,
          SUM(ABS(ct.amount)) as total_credits_consumed,
          AVG(ABS(ct.amount)) as avg_credits_per_transaction,
          COUNT(DISTINCT DATE(ct.created_at)) as active_days
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        ${whereClause}
      `;

      const { rows } = await dbConnection.query(sql, params);
      return rows[0] || {};
    } catch (error) {
      logger.error('获取概览分析失败:', error);
      throw error;
    }
  }

  /**
   * 获取时间序列分析数据
   */
  static async getTimeSeriesAnalytics(whereClause, params, granularity = 'day') {
    try {
      let dateFormat;
      let dateGroup;
      
      switch (granularity) {
        case 'week':
          dateFormat = '%Y-%u';
          dateGroup = 'DATE_FORMAT(ct.created_at, "%Y-%u")';
          break;
        case 'month':
          dateFormat = '%Y-%m';
          dateGroup = 'DATE_FORMAT(ct.created_at, "%Y-%m")';
          break;
        default: // day
          dateFormat = '%Y-%m-%d';
          dateGroup = 'DATE_FORMAT(ct.created_at, "%Y-%m-%d")';
      }

      // 修复：GROUP BY使用与SELECT相同的表达式
      const sql = `
        SELECT 
          DATE_FORMAT(ct.created_at, '${dateFormat}') as period,
          COUNT(DISTINCT ct.user_id) as unique_users,
          COUNT(*) as transaction_count,
          SUM(ABS(ct.amount)) as credits_consumed,
          AVG(ABS(ct.amount)) as avg_credits,
          COUNT(DISTINCT c.id) as conversation_count,
          SUM(CASE WHEN ct.transaction_type = 'chat_consume' THEN ABS(ct.amount) ELSE 0 END) as chat_credits,
          SUM(CASE WHEN ct.transaction_type = 'image_consume' THEN ABS(ct.amount) ELSE 0 END) as image_credits,
          SUM(CASE WHEN ct.transaction_type = 'video_consume' THEN ABS(ct.amount) ELSE 0 END) as video_credits
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        ${whereClause}
        GROUP BY DATE_FORMAT(ct.created_at, '${dateFormat}')
        ORDER BY period ASC
      `;

      const { rows } = await dbConnection.query(sql, params);
      return rows;
    } catch (error) {
      logger.error('获取时间序列分析失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户分析数据
   */
  static async getUserAnalytics(whereClause, params, tagIds = []) {
    try {
      // TOP活跃用户 - 修复：GROUP BY包含所有非聚合列
      const topUsersSql = `
        SELECT 
          u.id,
          u.username,
          u.email,
          g.name as group_name,
          COUNT(DISTINCT ct.id) as transaction_count,
          SUM(ABS(ct.amount)) as total_credits_consumed,
          COUNT(DISTINCT DATE(ct.created_at)) as active_days,
          COUNT(DISTINCT c.id) as conversation_count,
          GROUP_CONCAT(DISTINCT ut.name SEPARATOR ', ') as tags
        FROM users u
        LEFT JOIN credit_transactions ct ON u.id = ct.user_id
        LEFT JOIN conversations c ON ct.related_conversation_id = c.id
        LEFT JOIN user_groups g ON u.group_id = g.id
        LEFT JOIN user_tag_relations utr ON u.id = utr.user_id
        LEFT JOIN user_tags ut ON utr.tag_id = ut.id
        ${whereClause ? whereClause.replace('ct.', 'ct.').replace('u.', 'u.') : ''}
        GROUP BY u.id, u.username, u.email, g.name
        ORDER BY total_credits_consumed DESC
        LIMIT 20
      `;

      // 用户分布统计
      const distributionSql = `
        SELECT 
          CASE 
            WHEN total_credits < 100 THEN '0-100'
            WHEN total_credits < 500 THEN '100-500'
            WHEN total_credits < 1000 THEN '500-1000'
            WHEN total_credits < 5000 THEN '1000-5000'
            ELSE '5000+'
          END as credit_range,
          COUNT(*) as user_count
        FROM (
          SELECT 
            u.id,
            SUM(ABS(ct.amount)) as total_credits
          FROM users u
          LEFT JOIN credit_transactions ct ON u.id = ct.user_id
          ${whereClause ? whereClause.replace('ct.', 'ct.').replace('u.', 'u.') : ''}
          GROUP BY u.id
        ) as user_credits
        GROUP BY credit_range
        ORDER BY FIELD(credit_range, '0-100', '100-500', '500-1000', '1000-5000', '5000+')
      `;

      const [topUsersResult, distributionResult] = await Promise.all([
        dbConnection.query(topUsersSql, params),
        dbConnection.query(distributionSql, params)
      ]);

      return {
        topUsers: topUsersResult.rows,
        distribution: distributionResult.rows
      };
    } catch (error) {
      logger.error('获取用户分析失败:', error);
      throw error;
    }
  }

  /**
   * 获取模型使用分析
   */
  static async getModelAnalytics(whereClause, params) {
    try {
      // AI对话模型分析 - 修复：GROUP BY包含所有非聚合列
      const chatModelSql = `
        SELECT 
          c.model_name,
          am.display_name,
          am.provider,
          COUNT(DISTINCT c.id) as usage_count,
          COUNT(DISTINCT c.user_id) as unique_users,
          SUM(c.message_count) as total_messages,
          SUM(c.total_tokens) as total_tokens,
          SUM(ABS(ct.amount)) as credits_consumed,
          AVG(ABS(ct.amount)) as avg_credits_per_use
        FROM conversations c
        LEFT JOIN ai_models am ON c.model_name = am.name
        LEFT JOIN credit_transactions ct ON c.id = ct.related_conversation_id
        LEFT JOIN users u ON c.user_id = u.id
        ${whereClause}
        GROUP BY c.model_name, am.display_name, am.provider
        ORDER BY usage_count DESC
      `;

      // 图像生成模型分析 - 修复：将ct.created_at改为ig.created_at
      const imageModelSql = `
        SELECT 
          im.name as model_name,
          im.display_name,
          im.provider,
          COUNT(ig.id) as usage_count,
          COUNT(DISTINCT ig.user_id) as unique_users,
          SUM(ig.credits_consumed) as credits_consumed,
          AVG(ig.credits_consumed) as avg_credits_per_use
        FROM image_generations ig
        LEFT JOIN image_models im ON ig.model_id = im.id
        LEFT JOIN users u ON ig.user_id = u.id
        ${whereClause ? 'WHERE DATE(ig.created_at) >= ? AND DATE(ig.created_at) <= ? AND ig.status = \'success\'' + (whereClause.includes('u.group_id') ? ' AND u.group_id = ?' : '') : 'WHERE ig.status = \'success\''}
        GROUP BY im.id, im.name, im.display_name, im.provider
        ORDER BY usage_count DESC
      `;

      // 构建图像模型查询的参数，只使用前两个日期参数
      const imageParams = params.slice(0, 2);
      // 如果有groupId参数，添加到末尾
      if (whereClause && whereClause.includes('u.group_id') && params.length > 2) {
        imageParams.push(params[params.length - 1]);
      }

      const [chatResult, imageResult] = await Promise.all([
        dbConnection.query(chatModelSql, params),
        dbConnection.query(imageModelSql, imageParams)
      ]);

      return {
        chatModels: chatResult.rows,
        imageModels: imageResult.rows
      };
    } catch (error) {
      logger.error('获取模型分析失败:', error);
      throw error;
    }
  }

  /**
   * 获取功能模块使用分析
   */
  static async getModuleAnalytics(whereClause, params) {
    try {
      // 修复：如果有WHERE子句，用AND连接额外条件
      const moduleCondition = whereClause 
        ? whereClause + ' AND ct.transaction_type IN (\'chat_consume\', \'image_consume\', \'video_consume\', \'storage_upload\', \'html_publish\')'
        : 'WHERE ct.transaction_type IN (\'chat_consume\', \'image_consume\', \'video_consume\', \'storage_upload\', \'html_publish\')';

      const sql = `
        SELECT 
          ct.transaction_type,
          COUNT(*) as usage_count,
          COUNT(DISTINCT ct.user_id) as unique_users,
          SUM(ABS(ct.amount)) as credits_consumed,
          AVG(ABS(ct.amount)) as avg_credits,
          CASE 
            WHEN ct.transaction_type = 'chat_consume' THEN '对话'
            WHEN ct.transaction_type = 'image_consume' THEN '图像生成'
            WHEN ct.transaction_type = 'video_consume' THEN '视频生成'
            WHEN ct.transaction_type = 'storage_upload' THEN '文件存储'
            WHEN ct.transaction_type = 'html_publish' THEN 'HTML编辑器'
            ELSE '其他'
          END as module_name
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.user_id = u.id
        ${moduleCondition}
        GROUP BY ct.transaction_type
        ORDER BY credits_consumed DESC
      `;

      const { rows } = await dbConnection.query(sql, params);
      return rows;
    } catch (error) {
      logger.error('获取模块分析失败:', error);
      throw error;
    }
  }

  /**
   * 获取标签维度分析
   */
  static async getTagAnalytics(groupId) {
    try {
      if (!groupId) {
        return [];
      }

      // 修复：GROUP BY包含所有非聚合列
      const sql = `
        SELECT 
          ut.id,
          ut.name as tag_name,
          ut.color,
          COUNT(DISTINCT utr.user_id) as user_count,
          COUNT(DISTINCT ct.id) as transaction_count,
          SUM(ABS(ct.amount)) as credits_consumed,
          AVG(ABS(ct.amount)) as avg_credits_per_user
        FROM user_tags ut
        LEFT JOIN user_tag_relations utr ON ut.id = utr.tag_id
        LEFT JOIN credit_transactions ct ON utr.user_id = ct.user_id
        WHERE ut.group_id = ?
        GROUP BY ut.id, ut.name, ut.color
        ORDER BY user_count DESC
      `;

      const { rows } = await dbConnection.query(sql, [groupId]);
      return rows;
    } catch (error) {
      logger.error('获取标签分析失败:', error);
      throw error;
    }
  }

  /**
   * 导出分析报表为Excel
   */
  static async exportAnalyticsToExcel(analyticsData) {
    try {
      const wb = XLSX.utils.book_new();

      // 概览表
      if (analyticsData.overview) {
        const overviewData = [{
          '指标': '总用户数',
          '数值': analyticsData.overview.total_users || 0
        }, {
          '指标': '7日活跃用户',
          '数值': analyticsData.overview.active_users_7d || 0
        }, {
          '指标': '30日活跃用户',
          '数值': analyticsData.overview.active_users_30d || 0
        }, {
          '指标': '总对话数',
          '数值': analyticsData.overview.total_conversations || 0
        }, {
          '指标': '总消息数',
          '数值': analyticsData.overview.total_messages || 0
        }, {
          '指标': '总积分消耗',
          '数值': analyticsData.overview.total_credits_consumed || 0
        }, {
          '指标': '平均每笔消耗',
          '数值': Math.round(analyticsData.overview.avg_credits_per_transaction || 0)
        }];
        
        const ws = XLSX.utils.json_to_sheet(overviewData);
        ws['!cols'] = [{ wch: 20 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws, '概览');
      }

      // 时间趋势表
      if (analyticsData.timeSeries && analyticsData.timeSeries.length > 0) {
        const timeData = analyticsData.timeSeries.map(item => ({
          '时间': item.period,
          '独立用户': item.unique_users,
          '交易次数': item.transaction_count,
          '积分消耗': item.credits_consumed,
          '平均消耗': Math.round(item.avg_credits || 0),
          '对话数': item.conversation_count,
          '对话积分': item.chat_credits,
          '图像积分': item.image_credits,
          '视频积分': item.video_credits
        }));
        
        const ws = XLSX.utils.json_to_sheet(timeData);
        ws['!cols'] = [
          { wch: 12 }, { wch: 10 }, { wch: 10 }, 
          { wch: 10 }, { wch: 10 }, { wch: 10 },
          { wch: 10 }, { wch: 10 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '时间趋势');
      }

      // TOP用户表
      if (analyticsData.users && analyticsData.users.topUsers) {
        const userData = analyticsData.users.topUsers.map((user, index) => ({
          '排名': index + 1,
          '用户名': user.username,
          '邮箱': user.email,
          '所属组': user.group_name || '-',
          '标签': user.tags || '-',
          '交易次数': user.transaction_count,
          '积分消耗': user.total_credits_consumed,
          '活跃天数': user.active_days,
          '对话数': user.conversation_count
        }));
        
        const ws = XLSX.utils.json_to_sheet(userData);
        ws['!cols'] = [
          { wch: 8 }, { wch: 15 }, { wch: 25 }, 
          { wch: 15 }, { wch: 20 }, { wch: 10 },
          { wch: 10 }, { wch: 10 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'TOP用户');
      }

      // 模型使用表
      if (analyticsData.models) {
        // 对话模型
        if (analyticsData.models.chatModels && analyticsData.models.chatModels.length > 0) {
          const chatModelData = analyticsData.models.chatModels.map(model => ({
            '模型名称': model.display_name || model.model_name,
            '提供商': model.provider,
            '使用次数': model.usage_count,
            '独立用户': model.unique_users,
            '总消息数': model.total_messages,
            '总Token': model.total_tokens,
            '积分消耗': model.credits_consumed,
            '平均消耗': Math.round(model.avg_credits_per_use || 0)
          }));
          
          const ws = XLSX.utils.json_to_sheet(chatModelData);
          ws['!cols'] = [
            { wch: 20 }, { wch: 15 }, { wch: 10 },
            { wch: 10 }, { wch: 12 }, { wch: 12 },
            { wch: 10 }, { wch: 10 }
          ];
          XLSX.utils.book_append_sheet(wb, ws, '对话模型');
        }

        // 图像模型
        if (analyticsData.models.imageModels && analyticsData.models.imageModels.length > 0) {
          const imageModelData = analyticsData.models.imageModels.map(model => ({
            '模型名称': model.display_name || model.model_name,
            '提供商': model.provider,
            '使用次数': model.usage_count,
            '独立用户': model.unique_users,
            '积分消耗': model.credits_consumed,
            '平均消耗': Math.round(model.avg_credits_per_use || 0)
          }));
          
          const ws = XLSX.utils.json_to_sheet(imageModelData);
          ws['!cols'] = [
            { wch: 20 }, { wch: 15 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }
          ];
          XLSX.utils.book_append_sheet(wb, ws, '图像模型');
        }
      }

      // 功能模块表
      if (analyticsData.modules && analyticsData.modules.length > 0) {
        const moduleData = analyticsData.modules.map(module => ({
          '模块名称': module.module_name,
          '使用次数': module.usage_count,
          '独立用户': module.unique_users,
          '积分消耗': module.credits_consumed,
          '平均消耗': Math.round(module.avg_credits || 0)
        }));
        
        const ws = XLSX.utils.json_to_sheet(moduleData);
        ws['!cols'] = [
          { wch: 15 }, { wch: 10 }, { wch: 10 },
          { wch: 10 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '功能模块');
      }

      // 标签分析表
      if (analyticsData.tags && analyticsData.tags.length > 0) {
        const tagData = analyticsData.tags.map(tag => ({
          '标签名称': tag.tag_name,
          '用户数': tag.user_count,
          '交易次数': tag.transaction_count,
          '积分消耗': tag.credits_consumed,
          '人均消耗': Math.round(tag.avg_credits_per_user || 0)
        }));
        
        const ws = XLSX.utils.json_to_sheet(tagData);
        ws['!cols'] = [
          { wch: 15 }, { wch: 10 }, { wch: 10 },
          { wch: 10 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '标签分析');
      }

      // 生成文件
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      logger.error('导出Excel失败:', error);
      throw new Error('导出分析报表失败');
    }
  }
}

module.exports = AnalyticsService;
