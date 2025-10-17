/**
 * Agent测试会话管理服务
 * 管理测试对话的会话和消息历史（内存存储）
 */

const logger = require('../../utils/logger');

class TestSessionService {
  constructor() {
    // 内存存储：sessionId -> { messages: [], createdAt: Date }
    this.sessions = new Map();
    
    // 会话超时时间（30分钟）
    this.sessionTimeout = 30 * 60 * 1000;
    
    // 定期清理过期会话（每10分钟）
    setInterval(() => this.cleanExpiredSessions(), 10 * 60 * 1000);
  }

  /**
   * 创建新会话
   * @param {number} workflowId - 工作流ID
   * @param {number} userId - 用户ID
   * @returns {string} 会话ID
   */
  createSession(workflowId, userId) {
    const sessionId = `test_${workflowId}_${userId}_${Date.now()}`;
    
    this.sessions.set(sessionId, {
      workflowId,
      userId,
      messages: [],
      createdAt: new Date(),
      lastActiveAt: new Date()
    });
    
    logger.info('创建测试会话', { sessionId, workflowId, userId });
    
    return sessionId;
  }

  /**
   * 获取会话
   * @param {string} sessionId - 会话ID
   * @returns {Object|null} 会话对象
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return null;
    }
    
    // 检查是否过期
    const now = new Date();
    const elapsed = now - session.lastActiveAt;
    
    if (elapsed > this.sessionTimeout) {
      this.sessions.delete(sessionId);
      logger.info('会话已过期', { sessionId });
      return null;
    }
    
    return session;
  }

  /**
   * 添加消息到会话
   * @param {string} sessionId - 会话ID
   * @param {string} role - 角色（user/assistant）
   * @param {string} content - 消息内容
   */
  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    
    if (!session) {
      throw new Error('会话不存在或已过期');
    }
    
    session.messages.push({
      role,
      content,
      timestamp: new Date()
    });
    
    session.lastActiveAt = new Date();
    
    logger.debug('添加消息到会话', { 
      sessionId, 
      role, 
      messageCount: session.messages.length 
    });
  }

  /**
   * 获取会话消息历史
   * @param {string} sessionId - 会话ID
   * @returns {Array} 消息数组
   */
  getMessages(sessionId) {
    const session = this.getSession(sessionId);
    return session ? session.messages : [];
  }

  /**
   * 删除会话
   * @param {string} sessionId - 会话ID
   */
  deleteSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      logger.info('删除测试会话', { sessionId });
    }
  }

  /**
   * 清理过期会话
   */
  cleanExpiredSessions() {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const elapsed = now - session.lastActiveAt;
      
      if (elapsed > this.sessionTimeout) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.info('清理过期会话', { cleanedCount });
    }
  }

  /**
   * 获取会话统计信息
   */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      sessions: Array.from(this.sessions.entries()).map(([id, session]) => ({
        sessionId: id,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt
      }))
    };
  }
}

// 导出单例
module.exports = new TestSessionService();
