/**
 * Token自动刷新服务
 * 用于在AccessToken过期前自动刷新，确保用户不需要重新登录
 */

class TokenRefreshService {
  constructor() {
    this.refreshTimer = null
    this.isRefreshing = false
    // 提前5分钟刷新Token
    this.refreshAdvanceTime = 5 * 60 * 1000 // 5分钟
    // 页面激活检查间隔
    this.visibilityCheckTimer = null
    // 最后活动时间
    this.lastActivityTime = Date.now()
  }

  /**
   * 解析过期时间字符串（支持 s/m/h/d 格式）
   * @param {string} expiresIn - 过期时间字符串，如 "24h", "30d", "15m"
   * @returns {number} 毫秒数
   */
  parseExpiresIn(expiresIn) {
    if (!expiresIn) return 0
    
    // 提取数字和单位
    const match = expiresIn.match(/^(\d+)([smhd])$/i)
    if (!match) {
      // 如果没有单位，默认按秒处理
      const seconds = parseInt(expiresIn)
      return isNaN(seconds) ? 0 : seconds * 1000
    }
    
    const [, num, unit] = match
    const value = parseInt(num)
    
    switch (unit.toLowerCase()) {
      case 's': // 秒
        return value * 1000
      case 'm': // 分钟
        return value * 60 * 1000
      case 'h': // 小时
        return value * 60 * 60 * 1000
      case 'd': // 天
        return value * 24 * 60 * 60 * 1000
      default:
        return 0
    }
  }

  /**
   * 启动自动刷新
   * @param {Object} authStore - 认证存储实例
   */
  startAutoRefresh(authStore) {
    // 清除之前的定时器
    this.stopAutoRefresh()

    const state = authStore.getState()
    if (!state.accessToken || !state.tokenExpiresAt) {
      console.log('⏰ Token信息不完整，跳过自动刷新设置')
      return
    }

    // 计算下次刷新时间
    const expiresAt = new Date(state.tokenExpiresAt).getTime()
    const now = Date.now()
    const timeUntilExpiry = expiresAt - now
    
    // 如果Token已经过期或即将过期，立即刷新
    if (timeUntilExpiry <= this.refreshAdvanceTime) {
      console.log('⚠️ Token即将过期，立即刷新')
      this.refreshToken(authStore)
      return
    }

    // 计算刷新时间（过期前5分钟）
    const refreshTime = timeUntilExpiry - this.refreshAdvanceTime
    
    console.log('⏰ 设置Token自动刷新', {
      currentTime: new Date().toLocaleString(),
      expiresAt: new Date(expiresAt).toLocaleString(),
      refreshAt: new Date(now + refreshTime).toLocaleString(),
      refreshInMinutes: Math.round(refreshTime / 60000)
    })

    // 设置定时器
    this.refreshTimer = setTimeout(() => {
      console.log('⏰ 自动刷新Token时间到')
      this.refreshToken(authStore)
    }, refreshTime)

    // 启动页面可见性监听
    this.startVisibilityCheck(authStore)
  }

  /**
   * 启动页面可见性检查
   * @param {Object} authStore - 认证存储实例
   */
  startVisibilityCheck(authStore) {
    // 清除之前的监听
    if (this.visibilityCheckTimer) {
      clearInterval(this.visibilityCheckTimer)
    }

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // 页面变为可见
        const now = Date.now()
        const timeSinceLastActivity = now - this.lastActivityTime
        
        console.log('📱 页面激活，检查Token状态', {
          离开时长: Math.round(timeSinceLastActivity / 1000) + '秒'
        })
        
        // 如果离开超过1分钟，检查Token状态
        if (timeSinceLastActivity > 60000) {
          const state = authStore.getState()
          if (state.accessToken && state.tokenExpiresAt) {
            const expiresAt = new Date(state.tokenExpiresAt).getTime()
            const timeUntilExpiry = expiresAt - now
            
            // 如果Token将在10分钟内过期，立即刷新
            if (timeUntilExpiry <= 10 * 60 * 1000) {
              console.log('⚠️ 页面激活后发现Token即将过期，立即刷新')
              this.refreshToken(authStore)
            }
          }
        }
        
        this.lastActivityTime = now
      }
    }

    // 添加事件监听
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // 定期检查（每30秒）
    this.visibilityCheckTimer = setInterval(() => {
      this.lastActivityTime = Date.now()
      
      // 检查Token是否需要刷新
      const state = authStore.getState()
      if (state.accessToken && state.tokenExpiresAt) {
        const expiresAt = new Date(state.tokenExpiresAt).getTime()
        const now = Date.now()
        const timeUntilExpiry = expiresAt - now
        
        // 如果Token将在5分钟内过期且没有正在刷新，立即刷新
        if (timeUntilExpiry <= this.refreshAdvanceTime && !this.isRefreshing) {
          console.log('⚠️ 定期检查发现Token即将过期，立即刷新')
          this.refreshToken(authStore)
        }
      }
    }, 30000) // 每30秒检查一次

    // 保存清理函数
    this.cleanupVisibilityCheck = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (this.visibilityCheckTimer) {
        clearInterval(this.visibilityCheckTimer)
        this.visibilityCheckTimer = null
      }
    }
  }

  /**
   * 刷新Token
   * @param {Object} authStore - 认证存储实例
   */
  async refreshToken(authStore) {
    // 防止重复刷新
    if (this.isRefreshing) {
      console.log('🔄 Token正在刷新中，跳过重复请求')
      return
    }

    this.isRefreshing = true

    try {
      console.log('🔄 开始自动刷新Token')
      const state = authStore.getState()
      
      if (!state.refreshToken) {
        console.error('❌ 没有RefreshToken，无法自动刷新')
        this.isRefreshing = false
        return
      }

      // 调用authStore的刷新方法
      await authStore.refreshAccessToken()
      
      console.log('✅ Token自动刷新成功')
      
      // 刷新成功后，重新设置下一次自动刷新
      this.startAutoRefresh(authStore)
      
    } catch (error) {
      console.error('❌ Token自动刷新失败:', error)
      
      // 如果刷新失败，可能需要重新登录
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.log('🚪 RefreshToken无效，需要重新登录')
        // authStore会自动处理登出逻辑
      } else {
        // 网络错误等其他错误，5分钟后重试
        console.log('⏰ 5分钟后重试刷新')
        this.refreshTimer = setTimeout(() => {
          this.refreshToken(authStore)
        }, 5 * 60 * 1000)
      }
    } finally {
      this.isRefreshing = false
    }
  }

  /**
   * 停止自动刷新
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
      console.log('⏰ Token自动刷新已停止')
    }
    
    // 清理页面可见性监听
    if (this.cleanupVisibilityCheck) {
      this.cleanupVisibilityCheck()
      this.cleanupVisibilityCheck = null
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      isRunning: this.refreshTimer !== null,
      isRefreshing: this.isRefreshing,
      lastActivityTime: new Date(this.lastActivityTime).toLocaleString()
    }
  }
}

// 创建单例实例
const tokenRefreshService = new TokenRefreshService()

// 在开发环境下暴露到window对象方便调试
if (process.env.NODE_ENV === 'development') {
  window.tokenRefreshService = tokenRefreshService
}

export default tokenRefreshService
