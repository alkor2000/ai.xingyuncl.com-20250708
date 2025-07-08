import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient from '../utils/api'

const useAuthStore = create(
  persist(
    (set, get) => ({
      // 状态
      user: null,
      permissions: [],
      accessToken: null,
      isAuthenticated: false,
      loading: false,
      
      // 登录
      login: async (credentials) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login', credentials)
          const { user, permissions, accessToken } = response.data.data
          
          set({
            user,
            permissions,
            accessToken,
            isAuthenticated: true,
            loading: false
          })
          
          // 设置API客户端的默认头部
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
          
          return { success: true }
        } catch (error) {
          set({ loading: false })
          const message = error.response?.data?.message || '登录失败'
          return { success: false, message }
        }
      },
      
      // 注册
      register: async (userData) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/register', userData)
          set({ loading: false })
          return { success: true, data: response.data.data }
        } catch (error) {
          set({ loading: false })
          const message = error.response?.data?.message || '注册失败'
          return { success: false, message }
        }
      },
      
      // 登出
      logout: async () => {
        try {
          await apiClient.post('/auth/logout')
        } catch (error) {
          console.warn('登出请求失败:', error)
        } finally {
          set({
            user: null,
            permissions: [],
            accessToken: null,
            isAuthenticated: false
          })
          
          // 清除API客户端的认证头部
          delete apiClient.defaults.headers.common['Authorization']
        }
      },
      
      // 刷新用户信息
      refreshUserInfo: async () => {
        try {
          const response = await apiClient.get('/auth/me')
          const { user, permissions } = response.data.data
          
          set({ user, permissions })
          return { success: true }
        } catch (error) {
          // 如果刷新失败，可能token已过期，执行登出
          get().logout()
          return { success: false }
        }
      },
      
      // 检查权限
      hasPermission: (permission) => {
        const { permissions, user } = get()
        
        // 超级管理员拥有所有权限
        if (user?.role === 'super_admin') {
          return true
        }
        
        return permissions.includes(permission)
      },
      
      // 检查角色
      hasRole: (roles) => {
        const { user } = get()
        const roleArray = Array.isArray(roles) ? roles : [roles]
        return user && roleArray.includes(user.role)
      },
      
      // 检查邮箱可用性
      checkEmailAvailable: async (email) => {
        try {
          const response = await apiClient.get(`/auth/check-email?email=${email}`)
          return response.data.data.available
        } catch (error) {
          return false
        }
      },
      
      // 检查用户名可用性
      checkUsernameAvailable: async (username) => {
        try {
          const response = await apiClient.get(`/auth/check-username?username=${username}`)
          return response.data.data.available
        } catch (error) {
          return false
        }
      },
      
      // 初始化认证状态
      initAuth: () => {
        const { accessToken } = get()
        if (accessToken) {
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
        }
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        permissions: state.permissions,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
)

export default useAuthStore
