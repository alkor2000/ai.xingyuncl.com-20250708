/**
 * Agent外部API认证中间件
 * 
 * 职责：
 * 1. 从请求头提取API Key（Authorization: Bearer ak-xxx）
 * 2. 验证API Key有效性
 * 3. 检查访问控制（IP白名单、有效期、调用次数）
 * 4. 频率限制（基于Redis滑动窗口）
 * 5. 将工作流和用户信息注入req供后续使用
 */

const AgentApiKey = require('../models/AgentApiKey');
const redisConnection = require('../database/redis');
const logger = require('../utils/logger');

/**
 * API Key认证中间件
 * 验证请求携带的API Key并注入工作流上下文
 */
const agentApiAuth = async (req, res, next) => {
  try {
    /* 1. 提取API Key */
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_API_KEY',
          message: '缺少API Key，请在Authorization头中提供: Bearer ak-xxx'
        }
      });
    }

    const apiKey = authHeader.substring(7).trim();
    if (!apiKey || !apiKey.startsWith('ak-')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_API_KEY_FORMAT',
          message: 'API Key格式无效，应以ak-开头'
        }
      });
    }

    /* 2. 查找API Key记录 */
    const keyRecord = await AgentApiKey.findByApiKey(apiKey);
    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'API Key无效或不存在'
        }
      });
    }

    /* 3. 检查工作流是否已发布 */
    if (!keyRecord.is_published) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'WORKFLOW_NOT_PUBLISHED',
          message: '工作流未发布，无法通过API调用'
        }
      });
    }

    /* 4. 访问控制验证（有效期、次数上限、IP白名单） */
    const callerIp = req.ip || req.connection.remoteAddress;
    const accessCheck = keyRecord.validateAccess(callerIp);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: accessCheck.reason
        }
      });
    }

    /* 5. 频率限制（Redis滑动窗口） */
    const rateLimitResult = await checkRateLimit(keyRecord.id, keyRecord.rate_limit_per_minute);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `请求频率超限，每分钟最多${keyRecord.rate_limit_per_minute}次`,
          retry_after: rateLimitResult.retryAfter
        }
      });
    }

    /* 6. 注入上下文信息到req */
    req.agentApi = {
      keyId: keyRecord.id,
      keyRecord: keyRecord,
      workflowId: keyRecord.workflow_id,
      userId: keyRecord.user_id,
      callerIp: callerIp,
      workflowName: keyRecord.workflow_name,
      flowData: keyRecord.flow_data
    };

    next();
  } catch (error) {
    logger.error('Agent API认证失败:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: '认证服务异常，请稍后重试'
      }
    });
  }
};

/**
 * Redis滑动窗口频率限制
 * @param {number} keyId - API Key ID
 * @param {number} maxPerMinute - 每分钟最大请求数
 * @returns {Object} { allowed: boolean, retryAfter?: number }
 */
async function checkRateLimit(keyId, maxPerMinute) {
  try {
    const redis = redisConnection.getClient();
    if (!redis) {
      /* Redis不可用时降级放行 */
      return { allowed: true };
    }

    const rateLimitKey = `agent_api_rate:${keyId}`;
    const now = Date.now();
    const windowStart = now - 60000; /* 60秒滑动窗口 */

    /* 使用Redis sorted set实现滑动窗口 */
    const multi = redis.multi();
    /* 清除窗口外的旧记录 */
    multi.zRemRangeByScore(rateLimitKey, 0, windowStart);
    /* 获取窗口内的请求数 */
    multi.zCard(rateLimitKey);
    /* 添加当前请求 */
    multi.zAdd(rateLimitKey, { score: now, value: `${now}-${Math.random()}` });
    /* 设置key过期时间（防止孤儿key） */
    multi.expire(rateLimitKey, 120);

    const results = await multi.exec();
    const currentCount = results[1];

    if (currentCount >= maxPerMinute) {
      /* 计算最早记录到期时间 */
      const oldestRecords = await redis.zRange(rateLimitKey, 0, 0, { withScores: true });
      let retryAfter = 60;
      if (oldestRecords && oldestRecords.length > 0) {
        const oldestTime = oldestRecords[0].score || parseFloat(oldestRecords[0]);
        retryAfter = Math.ceil((oldestTime + 60000 - now) / 1000);
      }
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    return { allowed: true };
  } catch (error) {
    logger.error('频率限制检查失败，降级放行:', error);
    /* Redis异常时降级放行 */
    return { allowed: true };
  }
}

module.exports = { agentApiAuth };
