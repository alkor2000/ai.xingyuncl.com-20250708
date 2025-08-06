/**
 * 缓存服务 - 管理Redis缓存操作（性能优化版）
 */

const redisConnection = require('../database/redis');
const logger = require('../utils/logger');

class CacheService {
  // 缓存键前缀定义
  static CACHE_KEYS = {
    DRAFT: 'draft',
    MESSAGES: 'messages',
    AI_MODELS: 'ai_models',
    USER_MODELS: 'user_models',
    USER_PERMISSIONS: 'user_permissions',
    SYSTEM_SETTINGS: 'system_settings',
    SYSTEM_MODULES: 'system_modules',
    USER_GROUPS: 'user_groups',
    STATS: 'stats',
    MODEL_CONFIG: 'model_config'
  };

  // 缓存过期时间（秒）
  static CACHE_TTL = {
    SHORT: 60 * 5,           // 5分钟 - 用于频繁变化的数据
    MEDIUM: 60 * 30,         // 30分钟 - 用于一般数据
    LONG: 60 * 60 * 2,       // 2小时 - 用于不常变化的数据
    VERY_LONG: 60 * 60 * 24, // 24小时 - 用于静态数据
    DRAFT: 60 * 60 * 24 * 7  // 7天 - 用于草稿
  };

  /**
   * 通用缓存获取方法
   */
  static async getCache(cacheType, key, fallbackFunction = null, ttl = null) {
    try {
      if (!redisConnection.isConnected) {
        logger.debug('Redis未连接，直接执行回调');
        return fallbackFunction ? await fallbackFunction() : null;
      }

      const cacheKey = `${cacheType}:${key}`;
      const cached = await redisConnection.get(cacheKey);
      
      if (cached !== null) {
        logger.debug('缓存命中', { cacheType, key });
        return cached;
      }

      // 缓存未命中，执行回调函数获取数据
      if (fallbackFunction) {
        logger.debug('缓存未命中，执行回调', { cacheType, key });
        const data = await fallbackFunction();
        
        // 将数据存入缓存
        if (data !== null && data !== undefined) {
          await CacheService.setCache(cacheType, key, data, ttl);
        }
        
        return data;
      }

      return null;
    } catch (error) {
      logger.error('缓存获取失败:', { cacheType, key, error: error.message });
      // 出错时直接执行回调
      return fallbackFunction ? await fallbackFunction() : null;
    }
  }

  /**
   * 通用缓存设置方法
   */
  static async setCache(cacheType, key, data, ttl = null) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      const cacheKey = `${cacheType}:${key}`;
      const expireTime = ttl || CacheService.CACHE_TTL.MEDIUM;
      
      await redisConnection.set(cacheKey, data, expireTime);
      logger.debug('缓存设置成功', { cacheType, key, ttl: expireTime });
      
      return true;
    } catch (error) {
      logger.error('缓存设置失败:', { cacheType, key, error: error.message });
      return false;
    }
  }

  /**
   * 清除特定缓存
   */
  static async clearCache(cacheType, key) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      const cacheKey = `${cacheType}:${key}`;
      await redisConnection.del(cacheKey);
      
      logger.debug('缓存清除成功', { cacheType, key });
      return true;
    } catch (error) {
      logger.error('缓存清除失败:', { cacheType, key, error: error.message });
      return false;
    }
  }

  /**
   * 清除某类型的所有缓存（使用模式匹配）
   */
  static async clearCacheByType(cacheType) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      const pattern = `${cacheType}:*`;
      const client = redisConnection.getClient();
      
      // 使用SCAN查找所有匹配的键
      const keys = [];
      for await (const key of client.scanIterator({
        MATCH: `ai_platform:${pattern}`,
        COUNT: 100
      })) {
        keys.push(key);
      }

      // 批量删除
      if (keys.length > 0) {
        await client.del(keys);
        logger.info('批量清除缓存成功', { cacheType, count: keys.length });
      }
      
      return true;
    } catch (error) {
      logger.error('批量清除缓存失败:', { cacheType, error: error.message });
      return false;
    }
  }

  // ============ AI模型缓存 ============

  /**
   * 获取所有可用AI模型（带缓存）
   */
  static async getCachedAIModels(fallbackFunction) {
    return await CacheService.getCache(
      CacheService.CACHE_KEYS.AI_MODELS,
      'all',
      fallbackFunction,
      CacheService.CACHE_TTL.LONG
    );
  }

  /**
   * 获取用户可用的AI模型（带缓存）
   */
  static async getCachedUserModels(userId, groupId, fallbackFunction) {
    const key = `${userId}:${groupId}`;
    return await CacheService.getCache(
      CacheService.CACHE_KEYS.USER_MODELS,
      key,
      fallbackFunction,
      CacheService.CACHE_TTL.MEDIUM
    );
  }

  /**
   * 清除AI模型缓存
   */
  static async clearAIModelsCache() {
    await CacheService.clearCacheByType(CacheService.CACHE_KEYS.AI_MODELS);
    await CacheService.clearCacheByType(CacheService.CACHE_KEYS.USER_MODELS);
    await CacheService.clearCacheByType(CacheService.CACHE_KEYS.MODEL_CONFIG);
  }

  // ============ 用户权限缓存 ============

  /**
   * 获取用户权限（带缓存）
   */
  static async getCachedUserPermissions(userId, fallbackFunction) {
    return await CacheService.getCache(
      CacheService.CACHE_KEYS.USER_PERMISSIONS,
      userId,
      fallbackFunction,
      CacheService.CACHE_TTL.MEDIUM
    );
  }

  /**
   * 清除用户权限缓存
   */
  static async clearUserPermissionsCache(userId = null) {
    if (userId) {
      await CacheService.clearCache(CacheService.CACHE_KEYS.USER_PERMISSIONS, userId);
    } else {
      await CacheService.clearCacheByType(CacheService.CACHE_KEYS.USER_PERMISSIONS);
    }
  }

  // ============ 系统设置缓存 ============

  /**
   * 获取系统设置（带缓存）
   */
  static async getCachedSystemSettings(fallbackFunction) {
    return await CacheService.getCache(
      CacheService.CACHE_KEYS.SYSTEM_SETTINGS,
      'all',
      fallbackFunction,
      CacheService.CACHE_TTL.VERY_LONG
    );
  }

  /**
   * 清除系统设置缓存
   */
  static async clearSystemSettingsCache() {
    await CacheService.clearCache(CacheService.CACHE_KEYS.SYSTEM_SETTINGS, 'all');
  }

  // ============ 用户组缓存 ============

  /**
   * 获取用户组列表（带缓存）
   */
  static async getCachedUserGroups(fallbackFunction) {
    return await CacheService.getCache(
      CacheService.CACHE_KEYS.USER_GROUPS,
      'all',
      fallbackFunction,
      CacheService.CACHE_TTL.LONG
    );
  }

  /**
   * 清除用户组缓存
   */
  static async clearUserGroupsCache() {
    await CacheService.clearCacheByType(CacheService.CACHE_KEYS.USER_GROUPS);
  }

  // ============ 统计数据缓存 ============

  /**
   * 获取统计数据（带缓存）
   */
  static async getCachedStats(statType, fallbackFunction) {
    return await CacheService.getCache(
      CacheService.CACHE_KEYS.STATS,
      statType,
      fallbackFunction,
      CacheService.CACHE_TTL.SHORT
    );
  }

  /**
   * 清除统计缓存
   */
  static async clearStatsCache() {
    await CacheService.clearCacheByType(CacheService.CACHE_KEYS.STATS);
  }

  // ============ 原有功能保留 ============

  /**
   * 保存对话草稿
   */
  static async saveDraft(userId, conversationId, content) {
    const key = `${userId}:${conversationId}`;
    return await CacheService.setCache(
      CacheService.CACHE_KEYS.DRAFT,
      key,
      content,
      CacheService.CACHE_TTL.DRAFT
    );
  }

  /**
   * 获取对话草稿
   */
  static async getDraft(userId, conversationId) {
    const key = `${userId}:${conversationId}`;
    return await CacheService.getCache(CacheService.CACHE_KEYS.DRAFT, key);
  }

  /**
   * 删除对话草稿
   */
  static async deleteDraft(userId, conversationId) {
    const key = `${userId}:${conversationId}`;
    return await CacheService.clearCache(CacheService.CACHE_KEYS.DRAFT, key);
  }

  /**
   * 缓存对话消息
   */
  static async cacheMessages(userId, conversationId, messages) {
    const key = `${userId}:${conversationId}`;
    return await CacheService.setCache(
      CacheService.CACHE_KEYS.MESSAGES,
      key,
      messages,
      CacheService.CACHE_TTL.MEDIUM
    );
  }

  /**
   * 获取缓存的消息
   */
  static async getCachedMessages(userId, conversationId) {
    const key = `${userId}:${conversationId}`;
    return await CacheService.getCache(CacheService.CACHE_KEYS.MESSAGES, key);
  }

  /**
   * 清除对话缓存
   */
  static async clearConversationCache(userId, conversationId) {
    try {
      const messageKey = `${userId}:${conversationId}`;
      const draftKey = `${userId}:${conversationId}`;
      
      await Promise.all([
        CacheService.clearCache(CacheService.CACHE_KEYS.MESSAGES, messageKey),
        CacheService.clearCache(CacheService.CACHE_KEYS.DRAFT, draftKey)
      ]);
      
      logger.info('对话缓存清除成功', { userId, conversationId });
      return true;
    } catch (error) {
      logger.error('清除对话缓存失败:', error);
      return false;
    }
  }

  // ============ 缓存统计 ============

  /**
   * 获取缓存统计信息
   */
  static async getCacheStats() {
    try {
      if (!redisConnection.isConnected) {
        return { connected: false };
      }

      const client = redisConnection.getClient();
      const info = await client.info('memory');
      const dbSize = await client.dbSize();

      // 统计各类型缓存的数量
      const stats = {
        connected: true,
        totalKeys: dbSize,
        memoryUsed: info.match(/used_memory_human:(.+)/)?.[1] || 'N/A',
        cacheTypes: {}
      };

      // 统计每种类型的缓存数量
      for (const [name, prefix] of Object.entries(CacheService.CACHE_KEYS)) {
        let count = 0;
        for await (const key of client.scanIterator({
          MATCH: `ai_platform:${prefix}:*`,
          COUNT: 100
        })) {
          count++;
        }
        stats.cacheTypes[name] = count;
      }

      return stats;
    } catch (error) {
      logger.error('获取缓存统计失败:', error);
      return { connected: false, error: error.message };
    }
  }
}

module.exports = CacheService;
