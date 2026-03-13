/**
 * API 客户端配置 - 支持智能Token自动刷新和流式响应
 * 
 * 功能：
 * 1. axios 实例 + 请求/响应拦截器
 * 2. 401 自动Token刷新（队列机制，多请求只刷新一次）
 * 3. SSE 流式请求（postStream）
 * 4. 可取消请求（AbortController）
 * 
 * 修复：全局超时从0改为120秒，防止请求无限挂起
 */

import axios from 'axios'
import { message } from 'antd'

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 120000, // 全局默认120秒超时，防止请求无限挂起
  headers: {
    'Content-Type': 'application/json',
  },
})

// ============================================================
// Token刷新状态管理
// ============================================================

let isRefreshing = false
let failedQueue = []
let refreshAttempts = 0
const MAX_REFRESH_ATTEMPTS = 3

// 流式请求控制器
let currentStreamController = null

// 活跃请求控制器（支持多对话取消）
const activeRequestControllers = new Map()

/**
 * 处理等待队列中的请求
 */
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

// ============================================================
// localStorage 认证数据操作
// ============================================================

/**
 * 获取存储的认证数据
 */
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

/**
 * 更新存储的认证数据
 */
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

/**
 * 清除认证状态
 */
const clearAuthState = () => {
  try {
    localStorage.removeItem('auth-storage')
    delete apiClient.defaults.headers.common['Authorization']
    console.log('🚪 认证状态已清除')
  } catch (error) {
    console.error('清除认证状态失败:', error)
  }
}

// ============================================================
// Token刷新
// ============================================================

/**
 * 刷新Token（使用独立axios实例避免循环拦截）
 */
const refreshTokenFn = async () => {
  const authData = getAuthData()
  const { refreshToken } = authData

  if (!refreshToken) {
    throw new Error('没有有效的刷新令牌')
  }

  if (refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
    throw new Error('Token刷新尝试次数过多，请重新登录')
  }

  try {
    refreshAttempts++
    console.log(`🔄 开始Token刷新 (尝试 ${refreshAttempts}/${MAX_REFRESH_ATTEMPTS})`)

    const response = await axios.post('/api/auth/refresh', {
      refreshToken: refreshToken
    }, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    })

    if (response.data?.success && response.data?.data?.accessToken) {
      const { accessToken, expiresIn } = response.data.data

      updateAuthData({ accessToken })
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
      refreshAttempts = 0

      console.log('✅ Token自动刷新成功', { expiresIn, tokenLength: accessToken.length })
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

    if (error.response?.status === 401 ||
        error.response?.status === 403 ||
        refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
      refreshAttempts = 0
      clearAuthState()
    }

    throw error
  }
}

// ============================================================
// 请求拦截器
// ============================================================

apiClient.interceptors.request.use(
  (config) => {
    // 从 localStorage 获取 token
    const authData = getAuthData()
    if (authData.accessToken) {
      config.headers.Authorization = `Bearer ${authData.accessToken}`
    }

    // 添加请求ID用于追踪
    config.headers['X-Request-ID'] = Math.random().toString(36).substring(2)

    // 请求时间戳（用于计算耗时）
    config.metadata = { requestTime: Date.now() }

    // 特定请求的超时设置
    if (config.url?.includes('/auth/') || config.url?.includes('/admin/')) {
      config.timeout = 30000 // 管理请求30秒
    }

    return config
  },
  (error) => {
    console.error('请求配置失败:', error)
    return Promise.reject(error)
  }
)

// ============================================================
// 响应拦截器 - 智能Token刷新
// ============================================================

apiClient.interceptors.response.use(
  (response) => {
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

    // 401错误 + 未重试 + 非auth请求
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/')) {
        return Promise.reject(error)
      }

      if (isRefreshing) {
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

        processQueue(null, newToken)

        originalRequest.headers['Authorization'] = `Bearer ${newToken}`
        console.log('🔄 使用新Token重试原始请求')

        return apiClient(originalRequest)
      } catch (refreshError) {
        console.error('🚫 Token自动刷新失败，用户需要重新登录:', refreshError.message)

        processQueue(refreshError, null)

        if (refreshError.message.includes('尝试次数过多')) {
          message.error('登录状态异常，请重新登录')
        } else {
          message.error('登录已过期，请重新登录')
        }

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

    // 其他HTTP错误状态处理
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
        case 502: case 503: case 504:
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
      if (error.code === 'ERR_CANCELED' || error.message === 'canceled') {
        console.log('请求已取消')
      } else {
        console.error('网络错误:', error.message)
        message.error('网络连接失败，请检查网络')
      }
    } else {
      console.error('请求配置错误:', error.message)
    }

    return Promise.reject(error)
  }
)

// ============================================================
// 可取消请求方法
// ============================================================

/**
 * 创建可取消的请求
 */
const createCancelableRequest = (method, url, dataOrConfig, config) => {
  const controller = new AbortController()
  const requestId = `${method}-${url}-${Date.now()}`

  activeRequestControllers.set(requestId, controller)

  const finalConfig = { ...config, signal: controller.signal }

  const request = method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS'
    ? apiClient.request({ method, url, ...dataOrConfig, ...finalConfig })
    : apiClient.request({ method, url, data: dataOrConfig, ...finalConfig })

  request.finally(() => {
    activeRequestControllers.delete(requestId)
  })

  request.cancel = () => {
    controller.abort()
    activeRequestControllers.delete(requestId)
  }

  request.requestId = requestId

  return request
}

apiClient.get = (url, config) => createCancelableRequest('GET', url, config)
apiClient.post = (url, data, config) => createCancelableRequest('POST', url, data, config)
apiClient.put = (url, data, config) => createCancelableRequest('PUT', url, data, config)
apiClient.patch = (url, data, config) => createCancelableRequest('PATCH', url, data, config)
apiClient.delete = (url, config) => createCancelableRequest('DELETE', url, config)
apiClient.head = (url, config) => createCancelableRequest('HEAD', url, config)
apiClient.options = (url, config) => createCancelableRequest('OPTIONS', url, config)

// ============================================================
// Token工具方法
// ============================================================

/**
 * 检查Token是否过期（不验证签名，仅解析exp）
 */
apiClient.isTokenExpired = () => {
  const authData = getAuthData()
  if (!authData.accessToken) return true

  try {
    const payload = JSON.parse(atob(authData.accessToken.split('.')[1]))
    const now = Math.floor(Date.now() / 1000)
    return payload.exp < now
  } catch (error) {
    console.error('Token格式错误:', error)
    return true
  }
}

/**
 * 获取Token信息（用于调试）
 */
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

// ============================================================
// 流式请求（SSE）
// ============================================================

/**
 * 发送流式POST请求，解析SSE事件
 * 
 * @param {string} url - API路径（自动添加 /api 前缀）
 * @param {Object} data - 请求体
 * @param {Object} options - 回调 { onMessage, onError, onComplete, onInit }
 */
apiClient.postStream = async (url, data, options = {}) => {
  const authData = getAuthData()
  if (!authData.accessToken) {
    throw new Error('未认证，无法创建流式连接')
  }

  const { onMessage, onError, onComplete, onInit } = options

  const controller = new AbortController()
  currentStreamController = controller

  // 防止 error/done 后兜底 onComplete 重复触发
  let hasEnded = false

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
        setTimeout(() => { window.location.href = '/auth/login' }, 1000)
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

    // SSE解析循环
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('流式读取结束')
        break
      }

      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()

        // 空行 = 消息结束
        if (trimmed === '') {
          if (currentEvent && currentData) {
            try {
              const jsonData = JSON.parse(currentData)

              switch (currentEvent) {
                case 'init':
                  console.log('流式初始化:', jsonData)
                  if (onInit) onInit(jsonData)
                  break

                case 'message':
                  if (onMessage) onMessage(jsonData)
                  break

                case 'done':
                  console.log('流式完成:', jsonData)
                  hasEnded = true
                  if (onComplete) onComplete(jsonData)
                  return

                case 'error':
                  console.error('流式错误:', jsonData)
                  hasEnded = true
                  if (onError) {
                    const err = new Error(jsonData.error || '未知错误')
                    err.details = jsonData.details || ''
                    err.code = jsonData.code || ''
                    onError(err)
                  }
                  return

                default:
                  console.log(`收到事件 ${currentEvent}:`, jsonData)
              }
            } catch (e) {
              console.error('解析SSE数据失败:', e, 'data:', currentData)
            }

            currentEvent = null
            currentData = ''
          }
          continue
        }

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim()
        } else if (trimmed.startsWith('data:')) {
          const dataLine = trimmed.slice(5).trim()
          if (currentData) {
            currentData += '\n' + dataLine
          } else {
            currentData = dataLine
          }
        }
      }
    }

    // 未处理的buffer
    if (buffer.trim()) {
      console.warn('未处理的流式数据:', buffer)
    }

    // 兜底：没收到 done/error 事件时触发完成
    if (onComplete && !hasEnded) {
      console.log('流结束且未收到done/error事件，触发兜底完成回调')
      onComplete({ reason: 'stream_end' })
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('流式请求已取消')
      if (onComplete && !hasEnded) {
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

// ============================================================
// 请求取消方法
// ============================================================

/** 取消当前流式请求 */
apiClient.cancelStream = () => {
  if (currentStreamController) {
    currentStreamController.abort()
    currentStreamController = null
    console.log('流式请求已被取消')
  }
}

/** 取消所有活跃请求 */
apiClient.cancelAllRequests = () => {
  activeRequestControllers.forEach((controller, requestId) => {
    controller.abort()
    console.log(`取消请求: ${requestId}`)
  })
  activeRequestControllers.clear()
  apiClient.cancelStream()
}

/** 取消特定URL的请求 */
apiClient.cancelRequestByUrl = (url) => {
  activeRequestControllers.forEach((controller, requestId) => {
    if (requestId.includes(url)) {
      controller.abort()
      activeRequestControllers.delete(requestId)
      console.log(`取消请求: ${requestId}`)
    }
  })
}

// ============================================================
// 调试模式
// ============================================================

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

if (process.env.NODE_ENV === 'development') {
  apiClient.debug(true)
}

export default apiClient
