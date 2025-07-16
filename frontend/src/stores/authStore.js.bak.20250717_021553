/**
 * 认证状态管理
 */

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
      tokenExpiresAt: null,

      // 登录
      login: async (credentials) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login', credentials)
          const { 
            user, 
            permissions = [], 
            accessToken, 
            refreshToken, 
            expiresIn 
          } = response.data.data

          // 计算Token过期时间
          let tokenExpiresAt = null
          if (expiresIn) {
            // 解析过期时间（如 "12h"）
            const hours = parseInt(expiresIn.replace('h', '')) || 12
            tokenExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
          }

          set({
            user,
            permissions: permissions || [],
            accessToken,
            refreshToken,
            tokenExpiresAt,
            isAuthenticated: true,
            loading: false
          })

          // 设置默认请求头
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          console.log('✅ 用户登录成功:', {
            user: user.email,
            role: user.role,
            permissions: permissions.length,
            tokenExpires: tokenExpiresAt?.toLocaleString()
          })

          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ 登录失败:', error)
          throw error
        }
      },

      // 登出
      logout: async () => {
        try {
          const state = get()
          if (state.accessToken) {
            await apiClient.post('/auth/logout')
            console.log('📤 登出API调用成功')
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
            tokenExpiresAt: null,
            isAuthenticated: false
          })

          // 清除默认请求头
          delete apiClient.defaults.headers.common['Authorization']
          
          console.log('🚪 用户已登出')
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

          console.log('👤 用户信息已更新')
          return response.data
        } catch (error) {
          console.error('获取用户信息失败:', error)
          // 如果获取用户信息失败，可能token已过期，执行登出
          if (error.response?.status === 401) {
            get().logout()
          }
          throw error
        }
      },

      // 更新个人信息
      updateProfile: async (profileData) => {
        try {
          const response = await apiClient.put('/auth/profile', profileData)
          const { user } = response.data.data

          set({ user })

          console.log('✅ 个人信息更新成功')
          return response.data
        } catch (error) {
          console.error('更新个人信息失败:', error)
          throw error
        }
      },

      // 修改密码
      changePassword: async (oldPassword, newPassword) => {
        try {
          const response = await apiClient.put('/auth/password', {
            oldPassword,
            newPassword
          })

          console.log('✅ 密码修改成功')
          return response.data
        } catch (error) {
          console.error('修改密码失败:', error)
          throw error
        }
      },

      // 获取积分历史
      getCreditHistory: async (page = 1, limit = 20) => {
        try {
          const response = await apiClient.get('/auth/credit-history', {
            params: { page, limit }
          })

          console.log('📊 获取积分历史成功')
          return response.data.data
        } catch (error) {
          console.error('获取积分历史失败:', error)
          throw error
        }
      },

      // 注册
      register: async (userData) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/register', userData)
          console.log('✅ 注册成功')
          set({ loading: false })
          return { success: true, data: response.data }
        } catch (error) {
          set({ loading: false })
          console.error('❌ 注册失败:', error)
          const message = error.response?.data?.message || '注册失败'
          return { success: false, message }
        }
      },

      // 检查邮箱是否可用
      checkEmailAvailable: async (email) => {
        try {
          const response = await apiClient.post('/auth/check-email', { email })
          return response.data.data.available
        } catch (error) {
          return false
        }
      },

      // 检查用户名是否可用
      checkUsernameAvailable: async (username) => {
        try {
          const response = await apiClient.post('/auth/check-username', { username })
          return response.data.data.available
        } catch (error) {
          return false
        }
      },

      // 刷新令牌
      refreshAccessToken: async () => {
        const state = get()
        if (!state.refreshToken) {
          throw new Error('No refresh token available')
        }

        try {
          const response = await apiClient.post('/auth/refresh', {
            refreshToken: state.refreshToken
          })

          const { accessToken, expiresIn } = response.data.data

          // 计算新的过期时间
          let tokenExpiresAt = null
          if (expiresIn) {
            const hours = parseInt(expiresIn.replace('h', '')) || 12
            tokenExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
          }

          set({
            accessToken,
            tokenExpiresAt
          })

          // 更新默认请求头
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          console.log('🔄 Token刷新成功')
          return accessToken
        } catch (error) {
          console.error('Token刷新失败:', error)
          // 刷新失败，执行登出
          get().logout()
          throw error
        }
      },

      // 检查权限
      hasPermission: (permission) => {
        const { permissions } = get()
        return permissions.includes(permission) || 
               permissions.includes('system.all') ||
               permissions.some(p => p.endsWith('.*') && permission.startsWith(p.slice(0, -1)))
      },

      // 检查角色
      hasRole: (role) => {
        const { user } = get()
        if (!user) return false
        
        if (Array.isArray(role)) {
          return role.includes(user.role)
        }
        return user.role === role
      },

      // 检查Token是否过期
      isTokenExpired: () => {
        const { tokenExpiresAt } = get()
        if (!tokenExpiresAt) return true
        return new Date() >= new Date(tokenExpiresAt)
      },

      // 初始化认证状态
      initializeAuth: async () => {
        const state = get()
        
        if (!state.accessToken) {
          console.log('🔐 无访问令牌，跳过初始化')
          return
        }

        // 设置默认请求头
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`

        // 检查Token是否过期
        if (state.isTokenExpired()) {
          console.log('⏰ Token已过期，尝试刷新...')
          try {
            await state.refreshAccessToken()
          } catch (error) {
            console.error('Token刷新失败，需要重新登录')
            return
          }
        }

        // 获取最新用户信息
        try {
          await state.getCurrentUser()
          console.log('✅ 认证状态初始化成功')
        } catch (error) {
          console.error('❌ 获取用户信息失败:', error)
        }
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        permissions: state.permissions || [],
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        isAuthenticated: state.isAuthenticated
      }),
      onRehydrateStorage: () => (state) => {
        // 存储恢复后初始化认证状态
        console.log('🔄 恢复认证状态...')
        if (state?.accessToken) {
          state.initializeAuth()
        }
      }
    }
  )
)

export default useAuthStore
