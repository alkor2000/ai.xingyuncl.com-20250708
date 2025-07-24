/**
 * 消息重试服务
 * 处理发送失败的消息重试
 */

import { message as antMessage } from 'antd'

class MessageRetryService {
  constructor() {
    this.retryQueue = new Map() // messageId -> retryInfo
    this.maxRetries = 3
    this.retryDelay = 2000
    this.processing = false
  }

  /**
   * 添加消息到重试队列
   */
  addToRetryQueue(messageId, sendFunction, options = {}) {
    const retryInfo = {
      messageId,
      sendFunction,
      retryCount: 0,
      maxRetries: options.maxRetries || this.maxRetries,
      retryDelay: options.retryDelay || this.retryDelay,
      addedAt: Date.now(),
      lastAttempt: null,
      conversationId: options.conversationId,
      content: options.content
    }
    
    this.retryQueue.set(messageId, retryInfo)
    console.log('消息已添加到重试队列', { messageId, content: options.content })
    
    // 开始处理队列
    this.processQueue()
  }

  /**
   * 处理重试队列
   */
  async processQueue() {
    if (this.processing || this.retryQueue.size === 0) {
      return
    }
    
    this.processing = true
    
    for (const [messageId, retryInfo] of this.retryQueue) {
      if (retryInfo.retryCount >= retryInfo.maxRetries) {
        // 超过最大重试次数
        console.error('消息重试失败，已达到最大重试次数', { messageId })
        antMessage.error(`消息发送失败，请手动重试`)
        this.retryQueue.delete(messageId)
        continue
      }
      
      // 计算延迟时间（指数退避）
      const delay = retryInfo.retryDelay * Math.pow(2, retryInfo.retryCount)
      
      // 如果还没到重试时间，跳过
      if (retryInfo.lastAttempt && Date.now() - retryInfo.lastAttempt < delay) {
        continue
      }
      
      try {
        console.log(`正在重试消息 (${retryInfo.retryCount + 1}/${retryInfo.maxRetries})`, { messageId })
        
        retryInfo.retryCount++
        retryInfo.lastAttempt = Date.now()
        
        // 执行重试
        await retryInfo.sendFunction()
        
        // 成功后从队列中移除
        this.retryQueue.delete(messageId)
        console.log('消息重试成功', { messageId })
        antMessage.success('消息发送成功')
        
      } catch (error) {
        console.error('消息重试失败', { messageId, error, attempt: retryInfo.retryCount })
        
        if (retryInfo.retryCount >= retryInfo.maxRetries) {
          antMessage.error('消息发送失败，请检查网络连接')
          this.retryQueue.delete(messageId)
        } else {
          antMessage.warning(`消息发送失败，将在${delay / 1000}秒后重试`)
        }
      }
    }
    
    this.processing = false
    
    // 如果还有待重试的消息，继续处理
    if (this.retryQueue.size > 0) {
      setTimeout(() => this.processQueue(), 1000)
    }
  }

  /**
   * 从重试队列中移除消息
   */
  removeFromQueue(messageId) {
    if (this.retryQueue.has(messageId)) {
      this.retryQueue.delete(messageId)
      console.log('消息已从重试队列中移除', { messageId })
    }
  }

  /**
   * 清空重试队列
   */
  clearQueue() {
    this.retryQueue.clear()
    console.log('重试队列已清空')
  }

  /**
   * 获取重试队列状态
   */
  getQueueStatus() {
    return {
      size: this.retryQueue.size,
      processing: this.processing,
      items: Array.from(this.retryQueue.values()).map(item => ({
        messageId: item.messageId,
        retryCount: item.retryCount,
        conversationId: item.conversationId,
        addedAt: new Date(item.addedAt).toISOString()
      }))
    }
  }
}

// 创建单例
const messageRetryService = new MessageRetryService()

export default messageRetryService
