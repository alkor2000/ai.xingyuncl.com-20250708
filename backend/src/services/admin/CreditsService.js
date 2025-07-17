/**
 * 积分服务层 - 处理积分相关的业务逻辑
 */

const User = require('../../models/User');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError } = require('../../utils/errors');

class CreditsService {
  /**
   * 设置用户积分配额
   */
  static async setUserCredits(userId, creditsQuota, options = {}) {
    try {
      const { reason = '管理员设置', operatorId = null, expireDate = null } = options;

      if (typeof creditsQuota !== 'number' || creditsQuota < 0) {
        throw new ValidationError('积分配额必须是非负数字');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 设置积分配额
      const result = await user.setCreditsQuota(creditsQuota, reason, operatorId);

      // 如果提供了过期日期，同时设置
      if (expireDate) {
        await user.setCreditsExpireDate(new Date(expireDate), reason, operatorId);
        result.expireDate = expireDate;
      }

      logger.info('设置用户积分配额成功', {
        operatorId,
        userId,
        creditsQuota,
        expireDate,
        reason
      });

      return result;
    } catch (error) {
      logger.error('设置用户积分配额失败', { error: error.message, userId, creditsQuota });
      throw error;
    }
  }

  /**
   * 充值用户积分
   */
  static async addUserCredits(userId, amount, options = {}) {
    try {
      const { reason = '管理员充值', operatorId = null, extendDays = null } = options;

      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('充值金额必须是正数');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 执行充值
      const result = await user.addCredits(amount, reason, operatorId, extendDays);

      logger.info('充值用户积分成功', {
        operatorId,
        userId,
        amount,
        extendDays,
        reason,
        newQuota: result.newQuota,
        balanceAfter: result.balanceAfter
      });

      return result;
    } catch (error) {
      logger.error('充值用户积分失败', { error: error.message, userId, amount });
      throw error;
    }
  }

  /**
   * 扣减用户积分
   */
  static async deductUserCredits(userId, amount, options = {}) {
    try {
      const { reason = '管理员扣减', operatorId = null } = options;

      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('扣减金额必须是正数');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 执行扣减
      const result = await user.deductCredits(amount, reason, operatorId);

      logger.info('扣减用户积分成功', {
        operatorId,
        userId,
        amount,
        reason,
        newQuota: result.newQuota,
        balanceAfter: result.balanceAfter
      });

      return result;
    } catch (error) {
      logger.error('扣减用户积分失败', { error: error.message, userId, amount });
      throw error;
    }
  }

  /**
   * 消费积分（用于AI对话等）
   */
  static async consumeCredits(userId, amount, options = {}) {
    try {
      const { modelId = null, conversationId = null, reason = 'AI对话消费' } = options;

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 检查积分是否过期
      if (user.isCreditsExpired()) {
        const remainingDays = user.getCreditsRemainingDays();
        throw new ValidationError(
          `积分已过期${remainingDays === 0 ? '今天' : Math.abs(remainingDays) + '天前'}，请联系管理员续期`
        );
      }

      // 检查余额
      if (!user.hasCredits(amount)) {
        throw new ValidationError(
          `积分余额不足，当前余额: ${user.getCredits()}，需要: ${amount}`
        );
      }

      // 执行消费
      const result = await user.consumeCredits(amount, modelId, conversationId, reason);

      return result;
    } catch (error) {
      logger.error('消费积分失败', { error: error.message, userId, amount });
      throw error;
    }
  }

  /**
   * 设置积分有效期
   */
  static async setCreditsExpireDate(userId, expireDate, options = {}) {
    try {
      const { reason = '管理员设置', operatorId = null } = options;

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      const result = await user.setCreditsExpireDate(new Date(expireDate), reason, operatorId);

      logger.info('设置积分有效期成功', {
        operatorId,
        userId,
        expireDate,
        reason
      });

      return result;
    } catch (error) {
      logger.error('设置积分有效期失败', { error: error.message, userId, expireDate });
      throw error;
    }
  }

  /**
   * 延长积分有效期
   */
  static async extendCreditsExpireDate(userId, days, options = {}) {
    try {
      const { reason = '管理员延期', operatorId = null } = options;

      if (typeof days !== 'number' || days <= 0) {
        throw new ValidationError('延长天数必须是正数');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      const result = await user.extendCreditsExpireDate(days, reason, operatorId);

      logger.info('延长积分有效期成功', {
        operatorId,
        userId,
        days,
        reason,
        newExpireDate: result.expireDate
      });

      return result;
    } catch (error) {
      logger.error('延长积分有效期失败', { error: error.message, userId, days });
      throw error;
    }
  }

  /**
   * 获取用户积分历史
   */
  static async getUserCreditsHistory(userId, options = {}) {
    try {
      const { page = 1, limit = 20, transactionType = null } = options;

      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      const result = await User.getCreditHistory(userId, {
        page,
        limit,
        transaction_type: transactionType
      });

      return result;
    } catch (error) {
      logger.error('获取积分历史失败', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * 批量充值积分
   */
  static async batchAddCredits(userIds, amount, options = {}) {
    try {
      const { reason = '批量充值', operatorId = null, extendDays = null } = options;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new ValidationError('用户ID列表不能为空');
      }

      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('充值金额必须是正数');
      }

      const results = [];
      const errors = [];

      // 使用事务批量处理
      await dbConnection.transaction(async (query) => {
        for (const userId of userIds) {
          try {
            const user = await User.findById(userId);
            if (!user) {
              errors.push({ userId, error: '用户不存在' });
              continue;
            }

            await user.addCredits(amount, reason, operatorId, extendDays);
            results.push({ userId, success: true });
          } catch (error) {
            errors.push({ userId, error: error.message });
          }
        }
      });

      logger.info('批量充值积分完成', {
        operatorId,
        totalUsers: userIds.length,
        successCount: results.length,
        errorCount: errors.length,
        amount,
        reason
      });

      return {
        success: results.length > 0,
        results,
        errors,
        summary: {
          total: userIds.length,
          success: results.length,
          failed: errors.length
        }
      };
    } catch (error) {
      logger.error('批量充值积分失败', { error: error.message, userIds, amount });
      throw error;
    }
  }

  /**
   * 获取积分统计报表
   */
  static async getCreditsReport(options = {}) {
    try {
      const { startDate, endDate, groupBy = 'day' } = options;

      let dateFilter = '';
      const params = [];

      if (startDate) {
        dateFilter += ' AND ct.created_at >= ?';
        params.push(startDate);
      }

      if (endDate) {
        dateFilter += ' AND ct.created_at <= ?';
        params.push(endDate);
      }

      // 获取积分使用统计
      const sql = `
        SELECT 
          DATE(ct.created_at) as date,
          ct.transaction_type,
          COUNT(*) as transaction_count,
          SUM(ABS(ct.amount)) as total_amount,
          COUNT(DISTINCT ct.user_id) as unique_users
        FROM credit_transactions ct
        WHERE 1=1 ${dateFilter}
        GROUP BY DATE(ct.created_at), ct.transaction_type
        ORDER BY date DESC
      `;

      const { rows } = await dbConnection.query(sql, params);

      // 整理数据
      const report = {
        summary: {
          totalTransactions: rows.reduce((sum, row) => sum + parseInt(row.transaction_count), 0),
          totalAmount: rows.reduce((sum, row) => sum + parseFloat(row.total_amount), 0),
          uniqueUsers: new Set(rows.map(row => row.unique_users)).size
        },
        daily: rows
      };

      return report;
    } catch (error) {
      logger.error('获取积分统计报表失败', { error: error.message });
      throw error;
    }
  }
}

module.exports = CreditsService;
