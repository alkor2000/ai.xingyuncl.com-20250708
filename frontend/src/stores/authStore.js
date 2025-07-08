/**
 * 认证状态管理 - 支持智能Token管理
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
          get().logout()
          throw error
        }
      },

      // 手动刷新令牌 (通常由API拦截器自动调用)
      refreshAccessToken: async () => {
        const state = get()
        if (!state.refreshToken) {
          throw new Error('没有有效的刷新令牌')
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
          
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          console.log('🔄 Token手动刷新成功')
          return accessToken
        } catch (error) {
          console.error('Token手动刷新失败:', error)
          // 刷新令牌也失败了，执行登出
          get().logout()
          throw error
        }
      },

      // 检查Token是否即将过期（提前10分钟提醒）
      isTokenExpiringSoon: () => {
        const state = get()
        if (!state.tokenExpiresAt) return false
        
        const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000)
        return state.tokenExpiresAt < tenMinutesFromNow
      },

      // 获取Token剩余时间（分钟）
      getTokenTimeRemaining: () => {
        const state = get()
        if (!state.tokenExpiresAt) return 0
        
        const remainingMs = state.tokenExpiresAt.getTime() - Date.now()
        return Math.max(0, Math.floor(remainingMs / (1000 * 60)))
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
        const userRole = state.user?.role
        return roles.includes(userRole)
      },

      // 检查是否是管理员
      isAdmin: () => {
        const state = get()
        return ['super_admin', 'admin'].includes(state.user?.role)
      },

      // 初始化认证状态
      initializeAuth: () => {
        const state = get()
        if (state.accessToken) {
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`
          
          // 检查Token是否过期
          if (state.tokenExpiresAt && new Date() > state.tokenExpiresAt) {
            console.log('🔄 检测到Token已过期，清除认证状态')
            get().logout()
            return
          }
          
          // 验证token并获取最新用户信息
          get().getCurrentUser().catch(() => {
            console.log('🔄 Token验证失败，清除认证状态')
            get().logout()
          })
        }
      },

      // 获取用户显示信息
      getUserDisplayInfo: () => {
        const state = get()
        if (!state.user) return null
        
        return {
          name: state.user.username || state.user.email,
          email: state.user.email,
          role: state.user.role,
          roleText: {
            'super_admin': '超级管理员',
            'admin': '管理员',
            'user': '用户'
          }[state.user.role] || '未知',
          avatar: state.user.avatar,
          tokenQuota: state.user.token_quota,
          usedTokens: state.user.used_tokens,
          tokenRemaining: state.user.token_quota - (state.user.used_tokens || 0)
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
