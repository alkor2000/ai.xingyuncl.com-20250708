/**
 * 用户积分管理控制器 - 使用Service层处理业务逻辑
 */

const { CreditsService } = require('../../services/admin');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserCreditsController {
  /**
   * 获取用户积分信息
   */
  static async getUserCredits(req, res) {
    try {
      const { id } = req.params;
      
      // 从Service获取用户积分信息
      const creditsInfo = await CreditsService.getUserCreditsInfo(id);

      return ResponseHelper.success(res, creditsInfo, '获取用户积分信息成功');
    } catch (error) {
      logger.error('获取用户积分信息失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '获取用户积分信息失败');
    }
  }

  /**
   * 设置用户积分配额
   */
  static async setUserCredits(req, res) {
    try {
      const { id } = req.params;
      const { credits_quota, reason, expire_date } = req.body;
      
      const result = await CreditsService.setUserCredits(id, credits_quota, {
        reason,
        operatorId: req.user.id,
        expireDate: expire_date
      });

      return ResponseHelper.success(res, result, '积分配额设置成功');
    } catch (error) {
      logger.error('设置用户积分配额失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('必须')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '设置积分配额失败');
    }
  }

  /**
   * 充值用户积分
   */
  static async addUserCredits(req, res) {
    try {
      const { id } = req.params;
      const { amount, reason, extend_days } = req.body;
      
      const result = await CreditsService.addUserCredits(id, amount, {
        reason,
        operatorId: req.user.id,
        extendDays: extend_days
      });

      return ResponseHelper.success(res, result, '积分充值成功');
    } catch (error) {
      logger.error('充值用户积分失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('必须')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '充值积分失败');
    }
  }

  /**
   * 扣减用户积分
   */
  static async deductUserCredits(req, res) {
    try {
      const { id } = req.params;
      const { amount, reason } = req.body;
      
      const result = await CreditsService.deductUserCredits(id, amount, {
        reason,
        operatorId: req.user.id
      });

      return ResponseHelper.success(res, result, '积分扣减成功');
    } catch (error) {
      logger.error('扣减用户积分失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('必须')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '积分扣减失败');
    }
  }

  /**
   * 设置用户积分有效期
   */
  static async setUserCreditsExpire(req, res) {
    try {
      const { id } = req.params;
      const { expire_date, extend_days, reason } = req.body;
      
      let result;
      if (expire_date) {
        result = await CreditsService.setCreditsExpireDate(id, expire_date, {
          reason,
          operatorId: req.user.id
        });
      } else if (extend_days) {
        result = await CreditsService.extendCreditsExpireDate(id, extend_days, {
          reason,
          operatorId: req.user.id
        });
      } else {
        return ResponseHelper.validation(res, ['必须提供过期日期或延长天数']);
      }

      return ResponseHelper.success(res, result, '积分有效期设置成功');
    } catch (error) {
      logger.error('设置用户积分有效期失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      if (error.message.includes('必须')) {
        return ResponseHelper.validation(res, [error.message]);
      }
      
      return ResponseHelper.error(res, error.message || '设置积分有效期失败');
    }
  }

  /**
   * 获取用户积分使用历史
   */
  static async getUserCreditsHistory(req, res) {
    try {
      const { id } = req.params;
      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        transactionType: req.query.transaction_type
      };

      const result = await CreditsService.getUserCreditsHistory(id, options);

      return ResponseHelper.paginated(res, result.history, result.pagination, '获取积分历史成功');
    } catch (error) {
      logger.error('获取用户积分历史失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      
      if (error.message === '用户不存在') {
        return ResponseHelper.notFound(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '获取积分历史失败');
    }
  }
}

// 添加一个辅助方法到CreditsService（如果还没有的话）
const User = require('../../models/User');

CreditsService.getUserCreditsInfo = async function(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('用户不存在');
    }

    return {
      user_id: user.id,
      user_email: user.email,
      credits_quota: user.credits_quota,
      used_credits: user.used_credits,
      credits_expire_at: user.credits_expire_at,
      credits_stats: user.getCreditsStats()
    };
  } catch (error) {
    logger.error('获取用户积分信息失败', { error: error.message, userId });
    throw error;
  }
};

module.exports = UserCreditsController;
