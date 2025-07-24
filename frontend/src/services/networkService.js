/**
 * 网络状态监测服务（简化版）
 * 只监听浏览器的网络状态，不主动检查
 */

import { message } from 'antd'

class NetworkService {
  constructor() {
    this.isOnline = navigator.onLine
    this.listeners = new Set()
    this.messageKey = 'network-status'
    
    // 只监听浏览器的网络事件，不主动检查
    this.init()
  }

  init() {
    // 监听浏览器网络状态变化
    window.addEventListener('online', this.handleOnline.bind(this))
    window.addEventListener('offline', this.handleOffline.bind(this))
  }

  // 检查网络状态（空方法，保持接口兼容）
  async checkNetworkStatus() {
    // 不做任何检查
  }

  // 处理在线状态
  handleOnline() {
    console.log('浏览器检测到网络已连接')
    this.isOnline = true
    
    // 显示提示
    message.destroy(this.messageKey)
    message.success({ content: '网络已恢复', key: this.messageKey, duration: 2 })
    
    // 通知所有监听器
    this.notifyListeners('online')
  }

  // 处理离线状态
  handleOffline() {
    console.log('浏览器检测到网络已断开')
    this.isOnline = false
    
    // 显示提示
    message.error({ 
      content: '网络连接已断开，请检查网络', 
      key: this.messageKey,
      duration: 0 
    })
    
    // 通知所有监听器
    this.notifyListeners('offline')
  }

  // 添加监听器
  addListener(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  // 通知所有监听器
  notifyListeners(event) {
    this.listeners.forEach(callback => {
      try {
        callback(event, this.isOnline)
      } catch (error) {
        console.error('监听器执行失败:', error)
      }
    })
  }

  // 获取网络状态
  getStatus() {
    return {
      isOnline: this.isOnline,
      lastCheckTime: Date.now(),
      retryCount: 0
    }
  }

  // 销毁服务
  destroy() {
    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)
    
    this.listeners.clear()
    message.destroy(this.messageKey)
  }
}

// 创建单例
const networkService = new NetworkService()

// 导出服务
export default networkService
