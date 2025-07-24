/**
 * 流式响应恢复服务
 * 处理流式传输中断后的恢复
 */

const logger = require('../utils/logger');

class StreamRecoveryService {
  constructor() {
    // 存储活跃的流式会话
    this.activeSessions = new Map();
    
    // 定期清理过期会话
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 开始流式会话
   */
  startSession(sessionId, conversationId, messageId, userId) {
    const session = {
      sessionId,
      conversationId,
      messageId,
      userId,
      content: '',
      lastActivity: Date.now(),
      checkpoints: [] // 保存检查点，用于恢复
    };
    
    this.activeSessions.set(sessionId, session);
    logger.info('流式会话已创建', { sessionId, conversationId, messageId });
    
    return session;
  }

  /**
   * 更新会话内容
   */
  updateSession(sessionId, content, checkpoint = false) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      logger.warn('流式会话不存在', { sessionId });
      return null;
    }
    
    session.content = content;
    session.lastActivity = Date.now();
    
    // 如果是检查点，保存当前状态
    if (checkpoint) {
      session.checkpoints.push({
        content: content,
        timestamp: Date.now()
      });
      
      // 只保留最近10个检查点
      if (session.checkpoints.length > 10) {
        session.checkpoints.shift();
      }
    }
    
    return session;
  }

  /**
   * 获取会话用于恢复
   */
  getSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }
    
    // 检查会话是否过期（5分钟）
    if (Date.now() - session.lastActivity > 5 * 60 * 1000) {
      this.activeSessions.delete(sessionId);
      logger.info('流式会话已过期', { sessionId });
      return null;
    }
    
    return session;
  }

  /**
   * 恢复会话
   */
  recoverSession(sessionId, fromCheckpoint = false) {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }
    
    // 如果需要从检查点恢复
    if (fromCheckpoint && session.checkpoints.length > 0) {
      const lastCheckpoint = session.checkpoints[session.checkpoints.length - 1];
      return {
        ...session,
        content: lastCheckpoint.content,
        recoveredFrom: 'checkpoint'
      };
    }
    
    return {
      ...session,
      recoveredFrom: 'current'
    };
  }

  /**
   * 结束会话
   */
  endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.activeSessions.delete(sessionId);
      logger.info('流式会话已结束', { 
        sessionId, 
        duration: Date.now() - session.lastActivity 
      });
    }
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    const expiredSessions = [];
    
    this.activeSessions.forEach((session, sessionId) => {
      if (now - session.lastActivity > 5 * 60 * 1000) {
        expiredSessions.push(sessionId);
      }
    });
    
    expiredSessions.forEach(sessionId => {
      this.activeSessions.delete(sessionId);
    });
    
    if (expiredSessions.length > 0) {
      logger.info('清理过期流式会话', { count: expiredSessions.length });
    }
  }

  /**
   * 获取活跃会话统计
   */
  getStats() {
    return {
      activeSessionCount: this.activeSessions.size,
      sessions: Array.from(this.activeSessions.values()).map(session => ({
        sessionId: session.sessionId,
        userId: session.userId,
        contentLength: session.content.length,
        checkpoints: session.checkpoints.length,
        lastActivity: new Date(session.lastActivity).toISOString()
      }))
    };
  }
}

// 创建单例
const streamRecoveryService = new StreamRecoveryService();

module.exports = streamRecoveryService;
