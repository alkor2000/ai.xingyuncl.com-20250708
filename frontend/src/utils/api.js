import axios from 'axios'
import { message } from 'antd'

// 创建axios实例
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 可以在这里添加loading状态
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 检查业务状态码
    if (response.data && !response.data.success) {
      message.error(response.data.message || '请求失败')
      return Promise.reject(new Error(response.data.message))
    }
    
    return response
  },
  (error) => {
    // 处理HTTP错误状态码
    if (error.response) {
      const { status, data } = error.response
      
      switch (status) {
        case 401:
          message.error('登录已过期，请重新登录')
          // 清除本地存储的认证信息
          localStorage.removeItem('auth-storage')
          // 跳转到登录页
          if (window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
          break
          
        case 403:
          message.error(data?.message || '权限不足')
          break
          
        case 404:
          message.error(data?.message || '请求的资源不存在')
          break
          
        case 429:
          message.error(data?.message || '请求过于频繁，请稍后再试')
          break
          
        case 500:
          message.error(data?.message || '服务器内部错误')
          break
          
        default:
          message.error(data?.message || `请求失败 (${status})`)
      }
    } else if (error.request) {
      // 网络错误
      message.error('网络连接失败，请检查网络设置')
    } else {
      // 其他错误
      message.error(error.message || '未知错误')
    }
    
    return Promise.reject(error)
  }
)

export default apiClient
