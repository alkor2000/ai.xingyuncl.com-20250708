/**
 * 缓存服务 - 管理Redis缓存操作
 */

const redisConnection = require('../database/redis');
const logger = require('../utils/logger');

class CacheService {
  /**
   * 保存对话草稿
   */
  static async saveDraft(userId, conversationId, content) {
    try {
      if (!redisConnection.isConnected) {
        logger.warn('Redis未连接，无法保存草稿');
        return false;
      }

      const key = `draft:${userId}:${conversationId}`;
      // 草稿保存7天
      await redisConnection.set(key, content, 7 * 24 * 60 * 60);
      
      logger.info('草稿保存成功', { userId, conversationId });
      return true;
    } catch (error) {
      logger.error('保存草稿失败:', error);
      return false;
    }
  }

  /**
   * 获取对话草稿
   */
  static async getDraft(userId, conversationId) {
    try {
      if (!redisConnection.isConnected) {
        return null;
      }

      const key = `draft:${userId}:${conversationId}`;
      const content = await redisConnection.get(key);
      
      if (content) {
        logger.info('获取草稿成功', { userId, conversationId });
      }
      
      return content;
    } catch (error) {
      logger.error('获取草稿失败:', error);
      return null;
    }
  }

  /**
   * 删除对话草稿
   */
  static async deleteDraft(userId, conversationId) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      const key = `draft:${userId}:${conversationId}`;
      await redisConnection.del(key);
      
      logger.info('草稿删除成功', { userId, conversationId });
      return true;
    } catch (error) {
      logger.error('删除草稿失败:', error);
      return false;
    }
  }

  /**
   * 缓存对话消息
   */
  static async cacheMessages(userId, conversationId, messages) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      const key = `messages:${userId}:${conversationId}`;
      // 消息缓存1小时，加速切换
      await redisConnection.set(key, messages, 60 * 60);
      
      logger.info('消息缓存成功', { 
        userId, 
        conversationId, 
        messageCount: messages.length 
      });
      
      return true;
    } catch (error) {
      logger.error('缓存消息失败:', error);
      return false;
    }
  }

  /**
   * 获取缓存的消息
   */
  static async getCachedMessages(userId, conversationId) {
    try {
      if (!redisConnection.isConnected) {
        return null;
      }

      const key = `messages:${userId}:${conversationId}`;
      const messages = await redisConnection.get(key);
      
      if (messages) {
        logger.info('从缓存获取消息成功', { 
          userId, 
          conversationId,
          messageCount: messages.length 
        });
      }
      
      return messages;
    } catch (error) {
      logger.error('获取缓存消息失败:', error);
      return null;
    }
  }

  /**
   * 清除对话缓存
   */
  static async clearConversationCache(userId, conversationId) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      const messageKey = `messages:${userId}:${conversationId}`;
      const draftKey = `draft:${userId}:${conversationId}`;
      
      await Promise.all([
        redisConnection.del(messageKey),
        redisConnection.del(draftKey)
      ]);
      
      logger.info('对话缓存清除成功', { userId, conversationId });
      return true;
    } catch (error) {
      logger.error('清除对话缓存失败:', error);
      return false;
    }
  }
}

module.exports = CacheService;
