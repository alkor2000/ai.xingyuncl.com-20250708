/**
 * 速率限制服务 - 管理动态速率限制配置
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
        max: 100, // 默认提升到100次
        message: '认证请求过于频繁，请稍后再试'
      },
      emailCode: {
        windowMs: 60 * 60 * 1000, // 1小时
        max: 10, // 提升到10次
        message: '发送验证码过于频繁，请稍后再试'
      },
      global: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 2000, // 全局限制2000次
        message: '请求过于频繁，请稍后再试'
      },
      adminRead: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 3000, // 管理读操作3000次
        message: '读取操作过于频繁，请稍后再试'
      },
      adminWrite: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 500, // 管理写操作500次
        message: '写入操作过于频繁，请稍后再试'
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
      logger.info('速率限制配置已更新');
      return true;
    } catch (error) {
      logger.error('保存速率限制配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取或创建速率限制器
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
      // 使用内存存储（可以考虑使用Redis）
      store: undefined
    });

    // 缓存限制器
    this.limiters.set(type, limiter);
    return limiter;
  }

  /**
   * 创建默认限制器
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
   * 合并配置
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
        windowMinutes: Math.floor(value.windowMs / 60000), // 转换为分钟
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
        windowMs: value.windowMinutes * 60000, // 转换回毫秒
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
