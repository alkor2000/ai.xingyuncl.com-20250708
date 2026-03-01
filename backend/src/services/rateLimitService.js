/**
 * 速率限制服务 - 管理动态速率限制配置
 * 
 * v1.1 (2026-03-01):
 *   - 新增chat类型，对话限流纳入动态管理
 *   - chat.js不再硬编码，统一通过本服务获取限制器
 * v1.0:
 *   - 5种限制器(auth/emailCode/global/adminRead/adminWrite)
 *   - enabled字段支持禁用，配置热更新清除缓存
 */

const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

class RateLimitService {
  constructor() {
    // 存储速率限制器实例
    this.limiters = new Map();
    // 默认配置
    this.defaultConfig = {
      auth: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 100,
        message: '认证请求过于频繁，请稍后再试',
        enabled: true
      },
      emailCode: {
        windowMs: 60 * 60 * 1000, // 1小时
        max: 10,
        message: '发送验证码过于频繁，请稍后再试',
        enabled: true
      },
      global: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 2000,
        message: '请求过于频繁，请稍后再试',
        enabled: true
      },
      adminRead: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 3000,
        message: '读取操作过于频繁，请稍后再试',
        enabled: true
      },
      adminWrite: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 500,
        message: '写入操作过于频繁，请稍后再试',
        enabled: true
      },
      // v1.1 新增：对话系统限流，统一管理
      chat: {
        windowMs: 1 * 60 * 1000, // 1分钟
        max: 15,
        message: '对话频率过高，请稍后再试',
        enabled: true
      }
    };
  }

  /**
   * 获取速率限制配置
   */
  async getConfig() {
    try {
      const savedConfig = await SystemConfig.getSetting('rate_limit_config');
      if (savedConfig) {
        // 合并默认配置和保存的配置
        return this.mergeConfig(this.defaultConfig, savedConfig);
      }
      return this.defaultConfig;
    } catch (error) {
      logger.error('获取速率限制配置失败:', error);
      return this.defaultConfig;
    }
  }

  /**
   * 保存速率限制配置
   */
  async saveConfig(config) {
    try {
      await SystemConfig.updateSetting('rate_limit_config', config, 'json');
      // 清除所有缓存的限制器，强制重新创建
      this.limiters.clear();
      logger.info('速率限制配置已更新，缓存已清除');
      return true;
    } catch (error) {
      logger.error('保存速率限制配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取或创建速率限制器
   * 支持enabled字段，禁用时返回空中间件
   */
  async getLimiter(type) {
    // 如果已有缓存的限制器，直接返回
    if (this.limiters.has(type)) {
      return this.limiters.get(type);
    }

    // 获取配置
    const config = await this.getConfig();
    const limitConfig = config[type];
    
    if (!limitConfig) {
      logger.warn(`未找到类型为 ${type} 的速率限制配置，使用默认配置`);
      return this.createDefaultLimiter();
    }

    // 核心：检查enabled字段，禁用时直接放行
    if (limitConfig.enabled === false) {
      logger.info(`速率限制 ${type} 已禁用，跳过限制`);
      const noopMiddleware = (req, res, next) => next();
      this.limiters.set(type, noopMiddleware);
      return noopMiddleware;
    }

    // 创建限制器
    const limiter = rateLimit({
      windowMs: limitConfig.windowMs,
      max: limitConfig.max,
      message: {
        success: false,
        code: 429,
        message: limitConfig.message,
        data: null,
        timestamp: new Date().toISOString()
      },
      standardHeaders: true,
      legacyHeaders: false,
      store: undefined // 使用内存存储
    });

    // 缓存限制器
    this.limiters.set(type, limiter);
    logger.info(`速率限制 ${type} 已启用: ${limitConfig.max}次/${Math.floor(limitConfig.windowMs / 60000)}分钟`);
    return limiter;
  }

  /**
   * 创建默认限制器（找不到类型时的兜底）
   */
  createDefaultLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      message: {
        success: false,
        code: 429,
        message: '请求过于频繁，请稍后再试',
        data: null,
        timestamp: new Date().toISOString()
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }

  /**
   * 合并配置 - 已保存的配置覆盖默认配置
   */
  mergeConfig(defaultConfig, savedConfig) {
    const merged = { ...defaultConfig };
    
    for (const key in savedConfig) {
      if (savedConfig.hasOwnProperty(key) && merged.hasOwnProperty(key)) {
        merged[key] = { ...merged[key], ...savedConfig[key] };
      }
    }
    
    return merged;
  }

  /**
   * 获取格式化的配置（用于前端展示）
   */
  async getFormattedConfig() {
    const config = await this.getConfig();
    const formatted = {};
    
    for (const [key, value] of Object.entries(config)) {
      formatted[key] = {
        ...value,
        windowMinutes: Math.floor(value.windowMs / 60000),
        enabled: value.enabled !== false // 默认启用
      };
    }
    
    return formatted;
  }

  /**
   * 保存格式化的配置（从前端接收）
   */
  async saveFormattedConfig(formattedConfig) {
    const config = {};
    
    for (const [key, value] of Object.entries(formattedConfig)) {
      config[key] = {
        windowMs: value.windowMinutes * 60000,
        max: value.max,
        message: value.message,
        enabled: value.enabled !== false
      };
    }
    
    return await this.saveConfig(config);
  }
}

// 创建单例
const rateLimitService = new RateLimitService();

module.exports = rateLimitService;
