/**
 * API 客户端配置 - 支持智能Token自动刷新和流式响应
 * 优化：基于业界最佳实践改进SSE接收逻辑
 */

import axios from 'axios'
import { message } from 'antd'

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 0, // 去掉全局超时限制，让请求可以运行任意时长
  headers: {
    'Content-Type': 'application/json',
  },
})

// Token刷新状态管理
let isRefreshing = false
let failedQueue = []
let refreshAttempts = 0
const MAX_REFRESH_ATTEMPTS = 3

// 存储当前的流式请求控制器
let currentStreamController = null

// 存储所有活跃的请求控制器（支持多对话）
const activeRequestControllers = new Map()

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
    
    // 为特定请求设置超时（如刷新token等管理请求）
    if (config.url?.includes('/auth/') || config.url?.includes('/admin/')) {
      config.timeout = 30000 // 30秒超时
    }
    
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
      // 网络错误或请求被取消
      if (error.code === 'ERR_CANCELED' || error.message === 'canceled') {
        console.log('请求已取消')
      } else {
        console.error('网络错误:', error.message)
        message.error('网络连接失败，请检查网络')
      }
    } else {
      // 其他错误
      console.error('请求配置错误:', error.message)
    }
    
    return Promise.reject(error)
  }
)

// 扩展 apiClient 添加完整的HTTP方法（支持取消）
const createCancelableRequest = (method, url, dataOrConfig, config) => {
  // 创建取消控制器
  const controller = new AbortController()
  
  // 生成请求ID
  const requestId = `${method}-${url}-${Date.now()}`
  
  // 存储控制器
  activeRequestControllers.set(requestId, controller)
  
  // 合并配置
  const finalConfig = {
    ...config,
    signal: controller.signal
  }
  
  // 执行请求
  const request = method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS'
    ? apiClient.request({ method, url, ...dataOrConfig, ...finalConfig })
    : apiClient.request({ method, url, data: dataOrConfig, ...finalConfig })
  
  // 请求完成后清理控制器
  request.finally(() => {
    activeRequestControllers.delete(requestId)
  })
  
  // 添加取消方法
  request.cancel = () => {
    controller.abort()
    activeRequestControllers.delete(requestId)
  }
  
  // 添加请求ID
  request.requestId = requestId
  
  return request
}

apiClient.get = (url, config) => {
  return createCancelableRequest('GET', url, config)
}

apiClient.post = (url, data, config) => {
  return createCancelableRequest('POST', url, data, config)
}

apiClient.put = (url, data, config) => {
  return createCancelableRequest('PUT', url, data, config)
}

apiClient.patch = (url, data, config) => {
  return createCancelableRequest('PATCH', url, data, config)
}

apiClient.delete = (url, config) => {
  return createCancelableRequest('DELETE', url, config)
}

apiClient.head = (url, config) => {
  return createCancelableRequest('HEAD', url, config)
}

apiClient.options = (url, config) => {
  return createCancelableRequest('OPTIONS', url, config)
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

// 优化的流式请求处理 - 基于业界最佳实践
apiClient.postStream = async (url, data, options = {}) => {
  const authData = getAuthData()
  if (!authData.accessToken) {
    throw new Error('未认证，无法创建流式连接')
  }

  const { onMessage, onError, onComplete, onInit } = options
  
  // 创建AbortController用于取消请求
  const controller = new AbortController()
  currentStreamController = controller
  
  try {
    const response = await fetch(`/api${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.accessToken}`,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Request-ID': Math.random().toString(36).substring(2)
      },
      body: JSON.stringify(data),
      signal: controller.signal
    })

    if (!response.ok) {
      if (response.status === 401) {
        message.error('登录已过期，请重新登录')
        setTimeout(() => {
          window.location.href = '/auth/login'
        }, 1000)
      } else {
        const errorData = await response.json()
        throw new Error(errorData.message || `请求失败: ${response.status}`)
      }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = null
    let currentData = ''

    // 改进的SSE解析逻辑
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('流式读取结束')
        break
      }

      // 解码数据
      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk
      
      // 按行分割
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        
        // 空行表示消息结束
        if (trimmed === '') {
          if (currentEvent && currentData) {
            try {
              const jsonData = JSON.parse(currentData)
              
              // 处理不同的事件类型
              switch (currentEvent) {
                case 'init':
                  console.log('流式初始化:', jsonData)
                  if (onInit) onInit(jsonData)
                  break
                  
                case 'message':
                  // 使用delta或fullContent字段
                  if (onMessage) onMessage(jsonData)
                  break
                  
                case 'done':
                  console.log('流式完成:', jsonData)
                  if (onComplete) onComplete(jsonData)
                  return // 结束处理
                  
                case 'error':
                  console.error('流式错误:', jsonData)
                  if (onError) onError(new Error(jsonData.error || '未知错误'))
                  break
                  
                default:
                  console.log(`收到事件 ${currentEvent}:`, jsonData)
              }
            } catch (e) {
              console.error('解析SSE数据失败:', e, 'data:', currentData)
            }
            
            // 重置状态
            currentEvent = null
            currentData = ''
          }
          continue
        }
        
        // 解析事件类型
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim()
        }
        // 解析数据
        else if (trimmed.startsWith('data:')) {
          const dataLine = trimmed.slice(5).trim()
          if (currentData) {
            currentData += '\n' + dataLine
          } else {
            currentData = dataLine
          }
        }
      }
    }

    // 处理剩余的buffer
    if (buffer.trim()) {
      console.warn('未处理的流式数据:', buffer)
    }
    
    // 如果没有收到done事件，手动触发完成
    if (onComplete) {
      console.log('流结束，触发完成回调')
      onComplete({ reason: 'stream_end' })
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('流式请求已取消')
      if (onComplete) {
        onComplete({ cancelled: true })
      }
    } else {
      console.error('流式请求失败:', error)
      if (onError) onError(error)
      throw error
    }
  } finally {
    currentStreamController = null
  }
}

// 添加取消流式请求的方法
apiClient.cancelStream = () => {
  if (currentStreamController) {
    currentStreamController.abort()
    currentStreamController = null
    console.log('流式请求已被取消')
  }
}

// 取消所有活跃的请求
apiClient.cancelAllRequests = () => {
  activeRequestControllers.forEach((controller, requestId) => {
    controller.abort()
    console.log(`取消请求: ${requestId}`)
  })
  activeRequestControllers.clear()
  
  // 同时取消流式请求
  apiClient.cancelStream()
}

// 取消特定URL的请求
apiClient.cancelRequestByUrl = (url) => {
  activeRequestControllers.forEach((controller, requestId) => {
    if (requestId.includes(url)) {
      controller.abort()
      activeRequestControllers.delete(requestId)
      console.log(`取消请求: ${requestId}`)
    }
  })
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
