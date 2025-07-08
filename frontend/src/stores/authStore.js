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
      refreshToken: null,
      isAuthenticated: false,
      loading: false,

      // 登录
      login: async (credentials) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login', credentials)
          const { user, permissions = [], accessToken, refreshToken } = response.data.data

          set({
            user,
            permissions: permissions || [],
            accessToken,
            refreshToken,
            isAuthenticated: true,
            loading: false
          })

          // 设置默认请求头
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          return response.data
        } catch (error) {
          set({ loading: false })
          throw error
        }
      },

      // 注册
      register: async (userData) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/register', userData)
          set({ loading: false })
          return response.data
        } catch (error) {
          set({ loading: false })
          throw error
        }
      },

      // 登出
      logout: async () => {
        try {
          const state = get()
          if (state.accessToken) {
            await apiClient.post('/auth/logout')
          }
        } catch (error) {
          console.warn('登出API调用失败:', error)
        } finally {
          // 清除状态
          set({
            user: null,
            permissions: [],
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false
          })

          // 清除默认请求头
          delete apiClient.defaults.headers.common['Authorization']
        }
      },

      // 获取当前用户信息
      getCurrentUser: async () => {
        try {
          const response = await apiClient.get('/auth/me')
          const { user, permissions = [] } = response.data.data

          set({
            user,
            permissions: permissions || []
          })

          return response.data
        } catch (error) {
          // 如果获取用户信息失败，可能token已过期，执行登出
          get().logout()
          throw error
        }
      },

      // 刷新令牌
      refreshAccessToken: async () => {
        const state = get()
        if (!state.refreshToken) {
          throw new Error('没有有效的刷新令牌')
        }

        try {
          const response = await apiClient.post('/auth/refresh', {
            refreshToken: state.refreshToken
          })
          
          const { accessToken } = response.data.data

          set({ accessToken })
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          return accessToken
        } catch (error) {
          // 刷新令牌也失败了，执行登出
          get().logout()
          throw error
        }
      },

      // 检查是否有权限
      hasPermission: (permission) => {
        const state = get()
        const permissions = state.permissions || []
        return permissions.includes(permission)
      },

      // 检查是否有角色
      hasRole: (role) => {
        const state = get()
        return state.user?.role === role
      },

      // 检查是否有任一角色
      hasAnyRole: (roles) => {
        const state = get()
        return roles.includes(state.user?.role)
      },

      // 初始化认证状态
      initializeAuth: () => {
        const state = get()
        if (state.accessToken) {
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`
          // 验证token并获取最新用户信息
          get().getCurrentUser().catch(() => {
            // 如果验证失败，清除认证状态
            get().logout()
          })
        }
      }
    }),
    {
      name: 'auth-storage',
      // 只持久化必要的字段
      partialize: (state) => ({
        user: state.user,
        permissions: state.permissions || [],
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated
      }),
      onRehydrateStorage: () => (state) => {
        // 存储恢复后初始化认证状态
        if (state?.accessToken) {
          state.initializeAuth()
        }
      }
    }
  )
)

export default useAuthStore
