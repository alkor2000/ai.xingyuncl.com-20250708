/**
 * Redis缓存连接管理（单例模式）
 *
 * 职责：
 * 1. 管理Redis连接（自动重连）
 * 2. 提供带 keyPrefix 隔离的基础操作
 * 3. 自动 JSON 序列化/反序列化
 * 4. 为Identity Flow提供NX写入与GETDEL原子一次性消费
 *
 * 容错策略：
 * - Redis 不可用时不阻塞主服务启动（server.js 中处理）
 * - 普通缓存调用方可自行决定是否降级
 * - Identity认证流程不得降级；Identity Service会在Redis不可用时fail-closed
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
   *
   * 配置重连策略：最多重试 maxRetriesPerRequest 次，退避间隔递增
   * 监听连接事件更新 isConnected 状态
   */
  async initialize() {
    try {
      // 处理密码配置：空字符串视为无密码
      const redisPassword = config.database.redis.password || undefined;

      this.client = createClient({
        socket: {
          host: config.database.redis.host,
          port: config.database.redis.port,

          reconnectStrategy: (retries) => {
            if (retries > config.database.redis.maxRetriesPerRequest) {
              return false;
            }

            return Math.min(
              retries * config.database.redis.retryDelayOnFailover,
              3000
            );
          }
        },

        password: redisPassword,
        database: config.database.redis.db
      });

      // 连接事件监听
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

      // 建立连接
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
   * @returns {boolean} true 表示连接正常
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
   * 检查连接是否可用，不可用时抛出明确错误
   */
  _ensureConnected() {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis未连接，操作不可用');
    }
  }

  /**
   * 构造带统一业务前缀的Redis Key。
   *
   * @param {string} key - 业务Key
   * @returns {string} 完整Redis Key
   */
  _fullKey(key) {
    return config.database.redis.keyPrefix + key;
  }

  /**
   * 将Redis字符串尝试恢复为JSON。
   */
  _parseValue(value) {
    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * 获取Redis客户端实例
   * @returns {Object} Redis客户端
   */
  getClient() {
    this._ensureConnected();
    return this.client;
  }

  /**
   * 设置键值对
   *
   * @param {string} key - 键名（自动添加 keyPrefix）
   * @param {*} value - 值（非字符串自动JSON序列化）
   * @param {number|null} expireSeconds - 过期秒数，null 表示不过期
   * @returns {boolean} true 表示操作成功
   */
  async set(key, value, expireSeconds = null) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);
      const stringValue =
        typeof value === 'string' ? value : JSON.stringify(value);

      if (expireSeconds) {
        await this.client.setEx(
          fullKey,
          expireSeconds,
          stringValue
        );
      } else {
        await this.client.set(
          fullKey,
          stringValue
        );
      }

      return true;

    } catch (error) {
      logger.error('Redis SET操作失败:', {
        key,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 仅当Key不存在时写入。
   *
   * Identity state/handoff必须使用NX，防止随机值极端碰撞时覆盖已有安全上下文。
   *
   * @returns {boolean} true=本次成功创建；false=Key已经存在
   */
  async setIfAbsent(
    key,
    value,
    expireSeconds = null
  ) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);
      const stringValue =
        typeof value === 'string' ? value : JSON.stringify(value);

      const options = {
        NX: true
      };

      if (expireSeconds) {
        options.EX = expireSeconds;
      }

      const result = await this.client.set(
        fullKey,
        stringValue,
        options
      );

      return result === 'OK';

    } catch (error) {
      logger.error('Redis SET NX操作失败:', {
        key,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 获取值
   *
   * @param {string} key - 键名（自动添加 keyPrefix）
   * @returns {*} 解析后的值，键不存在返回 null
   */
  async get(key) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);
      const value = await this.client.get(fullKey);

      return this._parseValue(value);

    } catch (error) {
      logger.error('Redis GET操作失败:', {
        key,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 原子读取并删除。
   *
   * 使用Redis GETDEL确保Identity Flow和Handoff最多只成功消费一次。
   * 禁止用GET再DEL替代，否则并发请求可能重复消费同一安全票据。
   */
  async getDel(key) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);

      // 使用原生命令避免客户端方法命名差异。
      const value = await this.client.sendCommand([
        'GETDEL',
        fullKey
      ]);

      return this._parseValue(value);

    } catch (error) {
      logger.error('Redis GETDEL操作失败:', {
        key,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 删除键
   *
   * @param {string} key - 键名（自动添加 keyPrefix）
   * @returns {boolean} true 表示键存在且已删除
   */
  async del(key) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);
      const result = await this.client.del(fullKey);

      return result > 0;

    } catch (error) {
      logger.error('Redis DEL操作失败:', {
        key,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 检查键是否存在
   *
   * redis v4客户端exists()返回数字（0/1），统一转Boolean。
   */
  async exists(key) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);
      const result = await this.client.exists(fullKey);

      return Boolean(result);

    } catch (error) {
      logger.error('Redis EXISTS操作失败:', {
        key,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 设置过期时间
   */
  async expire(key, seconds) {
    try {
      this._ensureConnected();

      const fullKey = this._fullKey(key);
      const result = await this.client.expire(
        fullKey,
        seconds
      );

      return Boolean(result);

    } catch (error) {
      logger.error('Redis EXPIRE操作失败:', {
        key,
        seconds,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 获取连接状态信息
   */
  getStatus() {
    return {
      connected: this.isConnected,

      client: this.client
        ? {
            isOpen: this.client.isOpen,
            isReady: this.client.isReady
          }
        : null
    };
  }

  /**
   * 关闭连接
   * 优雅关闭时由 server.js 调用
   */
  async close() {
    try {
      if (this.client) {
        await this.client.quit();

        this.isConnected = false;

        logger.info('Redis连接已关闭');
      }

    } catch (error) {
      // 连接可能已经断开，quit 会失败，记录但不抛出
      logger.error(
        'Redis连接关闭时出错（可能已断开）:',
        error.message
      );

      this.isConnected = false;
    }
  }
}

// 单例实例
const redisConnection = new RedisConnection();

module.exports = redisConnection;
module.exports.RedisConnection = RedisConnection;
