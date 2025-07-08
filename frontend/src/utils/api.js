/**
 * API 客户端配置 - 支持智能Token自动刷新
 */

import axios from 'axios'
import { message } from 'antd'

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Token刷新状态管理
let isRefreshing = false
let failedQueue = []
let refreshAttempts = 0
const MAX_REFRESH_ATTEMPTS = 3

// 处理队列中的请求
const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  
  failedQueue = []
}

// 获取存储的认证数据
const getAuthData = () => {
  try {
    const data = localStorage.getItem('auth-storage')
    if (data) {
      const authData = JSON.parse(data)
      return authData?.state || {}
    }
  } catch (error) {
    console.error('解析认证数据失败:', error)
  }
  return {}
}

// 更新存储的认证数据
const updateAuthData = (updates) => {
  try {
    const data = localStorage.getItem('auth-storage')
    if (data) {
      const authData = JSON.parse(data)
      if (authData?.state) {
        Object.assign(authData.state, updates)
        localStorage.setItem('auth-storage', JSON.stringify(authData))
        console.log('🔄 认证数据已更新')
      }
    }
  } catch (error) {
    console.error('更新认证数据失败:', error)
  }
}

// 清除认证状态
const clearAuthState = () => {
  try {
    localStorage.removeItem('auth-storage')
    delete apiClient.defaults.headers.common['Authorization']
    console.log('🚪 认证状态已清除')
  } catch (error) {
    console.error('清除认证状态失败:', error)
  }
}

// 刷新Token的函数
const refreshTokenFn = async () => {
  const authData = getAuthData()
  const { refreshToken } = authData
  
  if (!refreshToken) {
    throw new Error('没有有效的刷新令牌')
  }

  // 检查刷新尝试次数
  if (refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
    throw new Error('Token刷新尝试次数过多，请重新登录')
  }

  try {
    refreshAttempts++
    console.log(`🔄 开始Token刷新 (尝试 ${refreshAttempts}/${MAX_REFRESH_ATTEMPTS})`)
    
    // 使用独立的axios实例避免循环拦截
    const response = await axios.post('/api/auth/refresh', {
      refreshToken: refreshToken
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
    if (response.data?.success && response.data?.data?.accessToken) {
      const { accessToken, expiresIn } = response.data.data
      
      // 更新存储和默认请求头
      updateAuthData({ accessToken })
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
      
      // 重置刷新尝试次数
      refreshAttempts = 0
      
      console.log('✅ Token自动刷新成功', {
        expiresIn,
        tokenLength: accessToken.length
      })
      
      return accessToken
    } else {
      throw new Error('刷新响应格式错误')
    }
  } catch (error) {
    console.error('❌ Token刷新失败:', {
      attempt: refreshAttempts,
      error: error.message,
      status: error.response?.status
    })
    
    // 如果是401/403错误或达到最大尝试次数，清除认证状态
    if (error.response?.status === 401 || 
        error.response?.status === 403 || 
        refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
      refreshAttempts = 0
      clearAuthState()
    }
    
    throw error
  }
}

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 从 localStorage 获取 token
    const authData = getAuthData()
    if (authData.accessToken) {
      config.headers.Authorization = `Bearer ${authData.accessToken}`
    }
    
    // 添加请求ID用于追踪
    config.headers['X-Request-ID'] = Math.random().toString(36).substring(2)
    
    // 添加时间戳用于调试
    config.metadata = { requestTime: Date.now() }
    
    return config
  },
  (error) => {
    console.error('请求配置失败:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器 - 智能Token刷新
apiClient.interceptors.response.use(
  (response) => {
    // 记录成功响应的时间
    if (response.config?.metadata?.requestTime) {
      const duration = Date.now() - response.config.metadata.requestTime
      if (duration > 5000) {
        console.log(`🐌 请求耗时较长: ${duration}ms - ${response.config.url}`)
      }
    }
    return response
  },
  async (error) => {
    const originalRequest = error.config
    
    // 只处理401错误且未重试过的请求
    if (error.response?.status === 401 && !originalRequest._retry) {
      // 跳过auth相关的请求，避免递归刷新
      if (originalRequest.url?.includes('/auth/')) {
        return Promise.reject(error)
      }

      if (isRefreshing) {
        // 如果正在刷新，将请求加入队列
        console.log('🔄 Token正在刷新中，请求加入等待队列')
        return new Promise((resolve, reject) => {
          failedQueue.push({ 
            resolve: (token) => {
              originalRequest.headers['Authorization'] = `Bearer ${token}`
              resolve(apiClient(originalRequest))
            },
            reject
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        console.log('🔄 检测到401错误，开始自动Token刷新流程')
        const newToken = await refreshTokenFn()
        
        // 处理等待队列中的请求
        processQueue(null, newToken)
        
        // 重试原始请求
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`
        console.log('🔄 使用新Token重试原始请求')
        
        return apiClient(originalRequest)
        
      } catch (refreshError) {
        console.error('🚫 Token自动刷新失败，用户需要重新登录:', refreshError.message)
        
        // 处理等待队列中的请求
        processQueue(refreshError, null)
        
        // 显示用户友好的错误信息
        if (refreshError.message.includes('尝试次数过多')) {
          message.error('登录状态异常，请重新登录')
        } else {
          message.error('登录已过期，请重新登录')
        }
        
        // 延迟跳转，确保用户能看到错误信息
        setTimeout(() => {
          if (window.location.pathname !== '/auth/login') {
            window.location.href = '/auth/login'
          }
        }, 1000)
        
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    // 处理其他HTTP错误状态
    if (error.response) {
      const { status, data } = error.response
      const errorMessage = data?.message || `请求失败 (${status})`
      
      switch (status) {
        case 400:
          console.warn('请求参数错误:', errorMessage)
          break
        case 403:
          message.error(errorMessage || '权限不足')
          break
        case 404:
          console.warn('资源不存在:', errorMessage)
          break
        case 429:
          message.error('请求过于频繁，请稍后再试')
          break
        case 500:
          message.error(errorMessage || '服务器内部错误')
          break
        case 502:
        case 503:
        case 504:
          message.error('服务暂时不可用，请稍后再试')
          break
        default:
          if (status >= 500) {
            message.error('服务器错误，请稍后重试')
          } else {
            console.warn('API请求失败:', errorMessage)
          }
      }
    } else if (error.request) {
      // 网络错误
      console.error('网络错误:', error.message)
      message.error('网络连接失败，请检查网络')
    } else {
      // 其他错误
      console.error('请求配置错误:', error.message)
    }
    
    return Promise.reject(error)
  }
)

// 扩展 apiClient 添加完整的HTTP方法
apiClient.get = (url, config) => {
  return apiClient.request({ method: 'GET', url, ...config })
}

apiClient.post = (url, data, config) => {
  return apiClient.request({ method: 'POST', url, data, ...config })
}

apiClient.put = (url, data, config) => {
  return apiClient.request({ method: 'PUT', url, data, ...config })
}

apiClient.patch = (url, data, config) => {
  return apiClient.request({ method: 'PATCH', url, data, ...config })
}

apiClient.delete = (url, config) => {
  return apiClient.request({ method: 'DELETE', url, ...config })
}

apiClient.head = (url, config) => {
  return apiClient.request({ method: 'HEAD', url, ...config })
}

apiClient.options = (url, config) => {
  return apiClient.request({ method: 'OPTIONS', url, ...config })
}

// 添加工具方法
apiClient.isTokenExpired = () => {
  const authData = getAuthData()
  if (!authData.accessToken) return true
  
  try {
    // 简单的JWT过期检查（不验证签名）
    const payload = JSON.parse(atob(authData.accessToken.split('.')[1]))
    const now = Math.floor(Date.now() / 1000)
    return payload.exp < now
  } catch (error) {
    console.error('Token格式错误:', error)
    return true
  }
}

apiClient.getTokenInfo = () => {
  const authData = getAuthData()
  if (!authData.accessToken) return null
  
  try {
    const payload = JSON.parse(atob(authData.accessToken.split('.')[1]))
    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
      timeToExpiry: Math.max(0, payload.exp - Math.floor(Date.now() / 1000))
    }
  } catch (error) {
    console.error('Token解析失败:', error)
    return null
  }
}

// 调试模式
apiClient.debug = (enabled = true) => {
  if (enabled) {
    apiClient.interceptors.request.use(request => {
      console.log('🚀 API Request:', {
        method: request.method?.toUpperCase(),
        url: request.url,
        baseURL: request.baseURL,
        data: request.data,
        headers: {
          Authorization: request.headers.Authorization ? '***' : undefined,
          'Content-Type': request.headers['Content-Type'],
          'X-Request-ID': request.headers['X-Request-ID']
        }
      })
      return request
    })
    
    apiClient.interceptors.response.use(
      response => {
        console.log('✅ API Response:', {
          status: response.status,
          url: response.config.url,
          duration: response.config.metadata ? 
            `${Date.now() - response.config.metadata.requestTime}ms` : 'unknown',
          dataSize: JSON.stringify(response.data).length
        })
        return response
      },
      error => {
        console.log('❌ API Error:', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
          errorData: error.response?.data
        })
        return Promise.reject(error)
      }
    )
  }
}

// 在开发环境启用调试
if (process.env.NODE_ENV === 'development') {
  apiClient.debug(true)
}

export default apiClient
