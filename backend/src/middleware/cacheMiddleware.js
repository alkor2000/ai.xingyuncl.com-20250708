/**
 * API响应缓存中间件
 * 缓存常用的API响应以提高性能
 */

const redisConnection = require('../database/redis');
const logger = require('../utils/logger');

/**
 * 创建缓存中间件
 * @param {number} ttl - 缓存时间（秒）
 * @param {string} prefix - 缓存键前缀
 */
function cacheMiddleware(ttl = 300, prefix = 'api_cache') {
  return async (req, res, next) => {
    // 只缓存GET请求
    if (req.method !== 'GET') {
      return next();
    }

    // 检查Redis是否可用
    if (!redisConnection.isConnected) {
      return next();
    }

    // 生成缓存键
    const cacheKey = `${prefix}:${req.user?.id || 'anonymous'}:${req.originalUrl}`;

    try {
      // 尝试从缓存获取
      const cached = await redisConnection.get(cacheKey);
      
      if (cached) {
        logger.info('从缓存返回响应', { url: req.originalUrl });
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }

      // 如果没有缓存，继续处理请求
      // 拦截res.json方法来缓存响应
      const originalJson = res.json.bind(res);
      
      res.json = function(data) {
        // 只缓存成功的响应
        if (data?.success) {
          redisConnection.set(cacheKey, data, ttl).catch(err => {
            logger.error('缓存响应失败:', err);
          });
        }
        
        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error('缓存中间件错误:', error);
      next();
    }
  };
}

module.exports = cacheMiddleware;
