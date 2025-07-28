/**
 * API服务控制器
 */

const APIService = require('../../models/APIService');
const User = require('../../models/User');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const dbConnection = require('../../database/connection');

class APIServiceController {
  /**
   * 获取所有API服务
   */
  static async getServices(req, res) {
    try {
      const services = await APIService.findAll();
      
      return ResponseHelper.success(res, services);
    } catch (error) {
      logger.error('获取API服务列表失败:', error);
      return ResponseHelper.error(res, '获取API服务列表失败');
    }
  }

  /**
   * 获取单个API服务
   */
  static async getService(req, res) {
    try {
      const { serviceId } = req.params;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      // 获取服务的操作列表
      const actions = await service.getActions();
      
      return ResponseHelper.success(res, {
        ...service,
        actions
      });
    } catch (error) {
      logger.error('获取API服务详情失败:', error);
      return ResponseHelper.error(res, '获取API服务详情失败');
    }
  }

  /**
   * 创建API服务
   */
  static async createService(req, res) {
    try {
      const { service_id, service_name, description } = req.body;
      
      // 验证必填字段
      if (!service_id || !service_name) {
        return ResponseHelper.validation(res, {
          service_id: !service_id ? '服务ID不能为空' : null,
          service_name: !service_name ? '服务名称不能为空' : null
        }, '请填写必填字段');
      }
      
      const service = await APIService.create({
        service_id,
        service_name,
        description
      });
      
      return ResponseHelper.success(res, service, 'API服务创建成功');
    } catch (error) {
      logger.error('创建API服务失败:', error);
      
      if (error.message === '服务ID已存在') {
        return ResponseHelper.validation(res, {
          service_id: '服务ID已存在'
        }, error.message);
      }
      
      return ResponseHelper.error(res, '创建API服务失败');
    }
  }

  /**
   * 更新API服务
   */
  static async updateService(req, res) {
    try {
      const { serviceId } = req.params;
      const { service_name, description, status } = req.body;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      await service.update({
        service_name,
        description,
        status
      });
      
      return ResponseHelper.success(res, service, 'API服务更新成功');
    } catch (error) {
      logger.error('更新API服务失败:', error);
      return ResponseHelper.error(res, '更新API服务失败');
    }
  }

  /**
   * 重置API密钥
   */
  static async resetApiKey(req, res) {
    try {
      const { serviceId } = req.params;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      const newApiKey = await service.resetApiKey();
      
      return ResponseHelper.success(res, {
        service_id: serviceId,
        api_key: newApiKey
      }, 'API密钥重置成功');
    } catch (error) {
      logger.error('重置API密钥失败:', error);
      return ResponseHelper.error(res, '重置API密钥失败');
    }
  }

  /**
   * 删除API服务
   */
  static async deleteService(req, res) {
    try {
      const { serviceId } = req.params;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      await service.delete();
      
      return ResponseHelper.success(res, null, 'API服务删除成功');
    } catch (error) {
      logger.error('删除API服务失败:', error);
      return ResponseHelper.error(res, '删除API服务失败');
    }
  }

  /**
   * 获取服务的操作配置
   */
  static async getServiceActions(req, res) {
    try {
      const { serviceId } = req.params;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      const actions = await service.getActions();
      
      return ResponseHelper.success(res, actions);
    } catch (error) {
      logger.error('获取服务操作列表失败:', error);
      return ResponseHelper.error(res, '获取服务操作列表失败');
    }
  }

  /**
   * 创建或更新服务操作配置
   */
  static async upsertServiceAction(req, res) {
    try {
      const { serviceId } = req.params;
      const { action_type, action_name, credits, description, status } = req.body;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      // 验证必填字段
      if (!action_type || !action_name || credits === undefined) {
        return ResponseHelper.validation(res, {
          action_type: !action_type ? '操作类型不能为空' : null,
          action_name: !action_name ? '操作名称不能为空' : null,
          credits: credits === undefined ? '消耗积分不能为空' : null
        }, '请填写必填字段');
      }
      
      const action = await service.upsertAction({
        action_type,
        action_name,
        credits,
        description,
        status
      });
      
      return ResponseHelper.success(res, action, '操作配置保存成功');
    } catch (error) {
      logger.error('保存服务操作配置失败:', error);
      return ResponseHelper.error(res, '保存服务操作配置失败');
    }
  }

  /**
   * 删除服务操作配置
   */
  static async deleteServiceAction(req, res) {
    try {
      const { serviceId, actionType } = req.params;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      const success = await service.deleteAction(actionType);
      
      if (!success) {
        return ResponseHelper.notFound(res, '操作配置不存在');
      }
      
      return ResponseHelper.success(res, null, '操作配置删除成功');
    } catch (error) {
      logger.error('删除服务操作配置失败:', error);
      return ResponseHelper.error(res, '删除服务操作配置失败');
    }
  }

  /**
   * 核心API：扣除用户积分
   * 供外部服务调用
   */
  static async deductCredits(req, res) {
    try {
      const serviceId = req.headers['x-service-id'];
      const apiKey = req.headers['x-api-key'];
      const { user_id, action_type, request_id, description } = req.body;
      
      // 验证请求头
      if (!serviceId || !apiKey) {
        return ResponseHelper.unauthorized(res, '缺少认证信息');
      }
      
      // 验证请求参数
      if (!user_id || !action_type || !request_id) {
        return ResponseHelper.validation(res, {
          user_id: !user_id ? '用户ID不能为空' : null,
          action_type: !action_type ? '操作类型不能为空' : null,
          request_id: !request_id ? '请求ID不能为空' : null
        }, '请求参数不完整');
      }
      
      // 验证API服务和密钥
      const service = await APIService.validateApiKey(serviceId, apiKey);
      if (!service) {
        return ResponseHelper.forbidden(res, '无效的服务ID或API密钥');
      }
      
      // 检查请求是否重复
      const isDuplicate = await APIService.checkDuplicateRequest(request_id);
      if (isDuplicate) {
        logger.info('检测到重复请求', { serviceId, requestId: request_id });
        // 对于重复请求，返回成功但不重复扣费
        return ResponseHelper.success(res, {
          credits_deducted: 0,
          balance: 0,
          duplicate: true
        }, '请求已处理');
      }
      
      // 获取操作配置
      const action = await service.getAction(action_type);
      if (!action) {
        return ResponseHelper.notFound(res, '操作类型不存在或已禁用');
      }
      
      // 获取用户信息
      const user = await User.findById(user_id);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }
      
      // 检查用户账号状态
      if (!user.isActive()) {
        return ResponseHelper.forbidden(res, '用户账号已禁用');
      }
      
      if (user.isAccountExpired()) {
        return ResponseHelper.forbidden(res, '用户账号已过期');
      }
      
      // 检查积分是否充足
      const requiredCredits = action.credits;
      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.custom(res, 402, {
          required: requiredCredits,
          balance: user.getCredits()
        }, '积分不足');
      }
      
      // 使用事务扣除积分
      const result = await dbConnection.transaction(async (query) => {
        // 更新用户已使用积分
        const updateSql = `
          UPDATE users 
          SET used_credits = used_credits + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await query(updateSql, [requiredCredits, user_id]);
        
        // 获取更新后的余额
        const { rows: balanceRows } = await query(
          'SELECT credits_quota - used_credits as balance FROM users WHERE id = ?',
          [user_id]
        );
        const balanceAfter = balanceRows[0].balance;
        
        // 记录积分消费历史
        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, 
           service_id, action_type, request_id)
          VALUES (?, ?, ?, 'api_consume', ?, ?, ?, ?)
        `;
        
        const finalDescription = description || `${service.service_name} - ${action.action_name}`;
        
        await query(historySql, [
          user_id, 
          -requiredCredits, 
          balanceAfter, 
          finalDescription,
          serviceId,
          action_type,
          request_id
        ]);
        
        return { balanceAfter };
      });
      
      logger.info('API积分扣费成功', {
        userId: user_id,
        serviceId,
        actionType: action_type,
        credits: requiredCredits,
        requestId: request_id,
        balance: result.balanceAfter
      });
      
      return ResponseHelper.success(res, {
        credits_deducted: requiredCredits,
        balance: result.balanceAfter,
        duplicate: false
      });
      
    } catch (error) {
      logger.error('API积分扣费失败:', error);
      
      if (error.message && error.message.includes('积分')) {
        return ResponseHelper.custom(res, 402, {
          error: error.message
        }, error.message);
      }
      
      return ResponseHelper.error(res, '积分扣费失败');
    }
  }

  /**
   * 获取API服务的使用统计
   */
  static async getServiceStats(req, res) {
    try {
      const { serviceId } = req.params;
      const { start_date, end_date } = req.query;
      
      const service = await APIService.findByServiceId(serviceId);
      
      if (!service) {
        return ResponseHelper.notFound(res, 'API服务不存在');
      }
      
      // 构建日期条件
      let dateCondition = '';
      const params = [serviceId];
      
      if (start_date) {
        dateCondition += ' AND ct.created_at >= ?';
        params.push(start_date);
      }
      
      if (end_date) {
        dateCondition += ' AND ct.created_at <= ?';
        params.push(end_date + ' 23:59:59');
      }
      
      // 查询统计数据
      const statsSql = `
        SELECT 
          COUNT(DISTINCT ct.user_id) as unique_users,
          COUNT(*) as total_requests,
          SUM(-ct.amount) as total_credits,
          ct.action_type,
          asa.action_name
        FROM credit_transactions ct
        LEFT JOIN api_service_actions asa ON ct.service_id = asa.service_id 
          AND ct.action_type = asa.action_type
        WHERE ct.service_id = ? AND ct.transaction_type = 'api_consume'
        ${dateCondition}
        GROUP BY ct.action_type, asa.action_name
      `;
      
      const { rows: actionStats } = await dbConnection.query(statsSql, params);
      
      // 查询总体统计
      const totalSql = `
        SELECT 
          COUNT(DISTINCT user_id) as total_unique_users,
          COUNT(*) as total_requests,
          SUM(-amount) as total_credits_consumed
        FROM credit_transactions
        WHERE service_id = ? AND transaction_type = 'api_consume'
        ${dateCondition}
      `;
      
      const { rows: totalStats } = await dbConnection.query(totalSql, params);
      
      return ResponseHelper.success(res, {
        service,
        summary: totalStats[0],
        action_stats: actionStats
      });
      
    } catch (error) {
      logger.error('获取服务统计失败:', error);
      return ResponseHelper.error(res, '获取服务统计失败');
    }
  }
}

module.exports = APIServiceController;
