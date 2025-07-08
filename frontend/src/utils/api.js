/**
 * API 客户端配置
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

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 从 localStorage 获取 token
    const token = localStorage.getItem('auth-storage')
    if (token) {
      try {
        const authData = JSON.parse(token)
        if (authData?.state?.accessToken) {
          config.headers.Authorization = `Bearer ${authData.state.accessToken}`
        }
      } catch (error) {
        console.error('解析认证数据失败:', error)
      }
    }
    
    // 添加请求ID用于追踪
    config.headers['X-Request-ID'] = Math.random().toString(36).substring(2)
    
    return config
  },
  (error) => {
    console.error('请求配置失败:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 成功响应直接返回
    return response
  },
  (error) => {
    console.error('API请求失败:', error)
    
    // 处理不同的错误状态
    if (error.response) {
      const { status, data } = error.response
      const errorMessage = data?.message || `请求失败 (${status})`
      
      switch (status) {
        case 400:
          message.error(errorMessage || '请求参数错误')
          break
        case 401:
          message.error('认证失败，请重新登录')
          // 清除认证信息
          localStorage.removeItem('auth-storage')
          // 跳转到登录页
          if (window.location.pathname !== '/auth/login') {
            window.location.href = '/auth/login'
          }
          break
        case 403:
          message.error(errorMessage || '权限不足')
          break
        case 404:
          message.error(errorMessage || '请求的资源不存在')
          break
        case 429:
          message.error('请求过于频繁，请稍后再试')
          break
        case 500:
          message.error(errorMessage || '服务器内部错误')
          break
        default:
          message.error(errorMessage || '请求失败，请稍后重试')
      }
    } else if (error.request) {
      // 网络错误
      message.error('网络错误，请检查网络连接')
    } else {
      // 其他错误
      message.error('请求失败，请稍后重试')
    }
    
    return Promise.reject(error)
  }
)

// 扩展 apiClient 添加常用方法
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

// 添加调试方法
apiClient.debug = (enabled = true) => {
  if (enabled) {
    apiClient.interceptors.request.use(request => {
      console.log('🚀 API Request:', {
        method: request.method?.toUpperCase(),
        url: request.url,
        baseURL: request.baseURL,
        data: request.data,
        headers: request.headers
      })
      return request
    })
    
    apiClient.interceptors.response.use(
      response => {
        console.log('✅ API Response:', {
          status: response.status,
          url: response.config.url,
          data: response.data
        })
        return response
      },
      error => {
        console.log('❌ API Error:', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
          data: error.response?.data
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
