/**
 * 用户积分管理控制器 - 使用中间件处理权限，移除重复检查
 */

const User = require('../../models/User');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class UserCreditsController {
  /**
   * 获取用户积分信息 - 权限检查已在中间件处理
   */
  static async getUserCredits(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      
      const user = req.targetUser || await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const creditsInfo = {
        user_id: user.id,
        user_email: user.email,
        credits_quota: user.credits_quota,
        used_credits: user.used_credits,
        credits_expire_at: user.credits_expire_at,
        credits_stats: user.getCreditsStats()
      };

      logger.info('获取用户积分信息成功', { 
        adminId: currentUser.id,
        adminRole: currentUser.role,
        targetUserId: id,
        creditsInfo
      });

      return ResponseHelper.success(res, creditsInfo, '获取用户积分信息成功');
    } catch (error) {
      logger.error('获取用户积分信息失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取用户积分信息失败');
    }
  }

  /**
   * 设置用户积分配额 - 权限检查已在中间件处理
   */
  static async setUserCredits(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { credits_quota, reason = '管理员调整积分配额', expire_date } = req.body;
      
      if (typeof credits_quota !== 'number' || credits_quota < 0) {
        return ResponseHelper.validation(res, ['积分配额必须是非负数字']);
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 设置积分配额
      const result = await user.setCreditsQuota(credits_quota, reason, req.user.id);
      
      // 如果提供了过期日期，同时设置过期时间
      if (expire_date) {
        await user.setCreditsExpireDate(new Date(expire_date), reason, req.user.id);
      }

      logger.info('超级管理员设置用户积分配额成功', { 
        adminId: req.user.id,
        targetUserId: id,
        newQuota: credits_quota,
        expireDate: expire_date,
        reason
      });

      return ResponseHelper.success(res, result, '积分配额设置成功');
    } catch (error) {
      logger.error('设置用户积分配额失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '设置积分配额失败');
    }
  }

  /**
   * 充值用户积分 - 权限检查已在中间件处理
   */
  static async addUserCredits(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { amount, reason = '管理员充值积分', extend_days } = req.body;
      
      if (typeof amount !== 'number' || amount <= 0) {
        return ResponseHelper.validation(res, ['充值金额必须是正数']);
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await user.addCredits(amount, reason, req.user.id, extend_days);

      logger.info('超级管理员充值用户积分成功', { 
        adminId: req.user.id,
        targetUserId: id,
        amount,
        extendDays: extend_days,
        reason
      });

      return ResponseHelper.success(res, result, '积分充值成功');
    } catch (error) {
      logger.error('充值用户积分失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '充值积分失败');
    }
  }

  /**
   * 扣减用户积分 - 权限检查已在中间件处理
   */
  static async deductUserCredits(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { amount, reason = '管理员扣减积分' } = req.body;
      
      if (typeof amount !== 'number' || amount <= 0) {
        return ResponseHelper.validation(res, ['扣减金额必须是正数']);
      }

      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await user.deductCredits(amount, reason, req.user.id);

      logger.info('超级管理员扣减用户积分成功', { 
        adminId: req.user.id,
        targetUserId: id,
        amount,
        reason
      });

      return ResponseHelper.success(res, result, '积分扣减成功');
    } catch (error) {
      logger.error('扣减用户积分失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '积分扣减失败');
    }
  }

  /**
   * 设置用户积分有效期 - 权限检查已在中间件处理
   */
  static async setUserCreditsExpire(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { expire_date, extend_days, reason = '管理员设置积分有效期' } = req.body;
      
      const user = await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      let result;
      if (expire_date) {
        // 设置具体日期
        result = await user.setCreditsExpireDate(new Date(expire_date), reason, req.user.id);
      } else if (extend_days) {
        // 延长天数
        result = await user.extendCreditsExpireDate(extend_days, reason, req.user.id);
      } else {
        return ResponseHelper.validation(res, ['必须提供过期日期或延长天数']);
      }

      logger.info('超级管理员设置用户积分有效期成功', { 
        adminId: req.user.id,
        targetUserId: id,
        expireDate: expire_date,
        extendDays: extend_days,
        reason
      });

      return ResponseHelper.success(res, result, '积分有效期设置成功');
    } catch (error) {
      logger.error('设置用户积分有效期失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '设置积分有效期失败');
    }
  }

  /**
   * 获取用户积分使用历史 - 权限检查已在中间件处理
   */
  static async getUserCreditsHistory(req, res) {
    try {
      const currentUser = req.user;
      const { id } = req.params;
      const { 
        page = 1, 
        limit = 20, 
        transaction_type = null 
      } = req.query;

      const user = req.targetUser || await User.findById(id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      const result = await User.getCreditHistory(id, {
        page: parseInt(page),
        limit: parseInt(limit),
        transaction_type
      });

      logger.info('获取用户积分历史成功', { 
        adminId: currentUser.id,
        adminRole: currentUser.role,
        targetUserId: id,
        historyCount: result.history.length
      });

      return ResponseHelper.paginated(res, result.history, result.pagination, '获取积分历史成功');
    } catch (error) {
      logger.error('获取用户积分历史失败', { 
        adminId: req.user?.id, 
        userId: req.params.id,
        error: error.message 
      });
      return ResponseHelper.error(res, '获取积分历史失败');
    }
  }
}

module.exports = UserCreditsController;
