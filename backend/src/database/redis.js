/**
 * Redis缓存连接管理
 */

const { createClient } = require('redis');
const config = require('../config');
const logger = require('../utils/logger');

class RedisConnection {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * 初始化Redis连接
   */
  async initialize() {
    try {
      this.client = createClient({
        socket: {
          host: config.database.redis.host,
          port: config.database.redis.port,
          reconnectStrategy: (retries) => {
            if (retries > config.database.redis.maxRetriesPerRequest) {
              return false;
            }
            return Math.min(retries * config.database.redis.retryDelayOnFailover, 3000);
          }
        },
        password: config.database.redis.password,
        database: config.database.redis.db
      });

      // 监听连接事件
      this.client.on('connect', () => {
        logger.info('Redis连接建立中...');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('Redis连接就绪', {
          host: config.database.redis.host,
          port: config.database.redis.port,
          db: config.database.redis.db
        });
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        logger.error('Redis连接错误:', err);
      });

      this.client.on('end', () => {
        this.isConnected = false;
        logger.warn('Redis连接已断开');
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis重新连接中...');
      });

      // 连接Redis
      await this.client.connect();
      
      // 测试连接
      await this.ping();
      
      logger.info('Redis初始化成功');

    } catch (error) {
      logger.error('Redis初始化失败:', error);
      throw error;
    }
  }

  /**
   * 测试连接
   */
  async ping() {
    try {
      const result = await this.client.ping();
      if (result !== 'PONG') {
        throw new Error('Redis ping响应异常');
      }
      return true;
    } catch (error) {
      logger.error('Redis ping失败:', error);
      throw error;
    }
  }

  /**
   * 获取Redis客户端
   */
  getClient() {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis客户端未初始化或连接已断开');
    }
    return this.client;
  }

  /**
   * 设置键值对
   */
  async set(key, value, expireSeconds = null) {
    try {
      const fullKey = config.database.redis.keyPrefix + key;
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (expireSeconds) {
        await this.client.setEx(fullKey, expireSeconds, stringValue);
      } else {
        await this.client.set(fullKey, stringValue);
      }
      
      return true;
    } catch (error) {
      logger.error('Redis SET操作失败:', { key, error: error.message });
      throw error;
    }
  }

  /**
   * 获取值
   */
  async get(key) {
    try {
      const fullKey = config.database.redis.keyPrefix + key;
      const value = await this.client.get(fullKey);
      
      if (value === null) {
        return null;
      }
      
      // 尝试解析JSON，如果失败则返回原始字符串
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error('Redis GET操作失败:', { key, error: error.message });
      throw error;
    }
  }

  /**
   * 删除键
   */
  async del(key) {
    try {
      const fullKey = config.database.redis.keyPrefix + key;
      const result = await this.client.del(fullKey);
      return result > 0;
    } catch (error) {
      logger.error('Redis DEL操作失败:', { key, error: error.message });
      throw error;
    }
  }

  /**
   * 检查键是否存在
   */
  async exists(key) {
    try {
      const fullKey = config.database.redis.keyPrefix + key;
      const result = await this.client.exists(fullKey);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS操作失败:', { key, error: error.message });
      throw error;
    }
  }

  /**
   * 设置过期时间
   */
  async expire(key, seconds) {
    try {
      const fullKey = config.database.redis.keyPrefix + key;
      const result = await this.client.expire(fullKey, seconds);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXPIRE操作失败:', { key, seconds, error: error.message });
      throw error;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.isConnected,
      client: this.client ? {
        isOpen: this.client.isOpen,
        isReady: this.client.isReady
      } : null
    };
  }

  /**
   * 关闭连接
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis连接已关闭');
    }
  }
}

// 创建单例实例
const redisConnection = new RedisConnection();

module.exports = redisConnection;
