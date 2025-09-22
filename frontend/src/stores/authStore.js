/**
 * 认证状态管理
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient from '../utils/api'
import useSystemConfigStore from './systemConfigStore'
import tokenRefreshService from '../services/tokenRefreshService'

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

      // 解析过期时间字符串（支持 s/m/h/d 格式）
      parseExpiresIn: (expiresIn) => {
        if (!expiresIn) return null
        
        // 提取数字和单位
        const match = expiresIn.match(/^(\d+)([smhd])$/i)
        if (!match) {
          // 如果没有单位，默认按秒处理
          const seconds = parseInt(expiresIn)
          if (isNaN(seconds)) return null
          return new Date(Date.now() + seconds * 1000)
        }
        
        const [, num, unit] = match
        const value = parseInt(num)
        let milliseconds = 0
        
        switch (unit.toLowerCase()) {
          case 's': // 秒
            milliseconds = value * 1000
            break
          case 'm': // 分钟
            milliseconds = value * 60 * 1000
            break
          case 'h': // 小时
            milliseconds = value * 60 * 60 * 1000
            break
          case 'd': // 天
            milliseconds = value * 24 * 60 * 60 * 1000
            break
          default:
            return null
        }
        
        return new Date(Date.now() + milliseconds)
      },

      // 登录
      login: async (credentials) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login', credentials)
          const { 
            user, 
            permissions = [], 
            siteConfig,
            accessToken, 
            refreshToken, 
            expiresIn 
          } = response.data.data

          // 使用改进的时间解析
          const tokenExpiresAt = get().parseExpiresIn(expiresIn)

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

          // 更新站点配置（如果有）
          if (siteConfig) {
            useSystemConfigStore.getState().setUserSiteConfig(siteConfig)
            console.log('🎨 已更新用户站点配置:', siteConfig)
          }

          // 🔥 重要：登录成功后清理之前用户的聊天数据
          if (window.useChatStore) {
            const chatStore = window.useChatStore.getState()
            if (chatStore && chatStore.reset) {
              console.log('🧹 清除之前的聊天数据...')
              chatStore.reset()
            }
          }

          // 启动Token自动刷新
          tokenRefreshService.startAutoRefresh({ getState: get })

          console.log('✅ 用户登录成功:', {
            user: user.email,
            role: user.role,
            permissions: permissions.length,
            tokenExpires: tokenExpiresAt?.toLocaleString(),
            hasSiteConfig: !!siteConfig
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
          // 停止Token自动刷新
          tokenRefreshService.stopAutoRefresh()
          
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
          
          // 清除站点配置
          useSystemConfigStore.getState().setUserSiteConfig(null)
          
          // 🔥 重要：清除聊天相关的所有状态
          if (window.useChatStore) {
            const chatStore = window.useChatStore.getState()
            if (chatStore && chatStore.reset) {
              console.log('🧹 清除聊天数据...')
              chatStore.reset()
            }
          }
          
          console.log('🚪 用户已登出')
          
          // 跳转到首页（自定义首页）
          window.location.href = '/'
        }
      },

      // 获取当前用户信息
      getCurrentUser: async () => {
        try {
          const response = await apiClient.get('/auth/me')
          const { user, permissions = [], siteConfig } = response.data.data

          set({
            user,
            permissions: permissions || []
          })

          // 更新站点配置（如果有）
          if (siteConfig) {
            useSystemConfigStore.getState().setUserSiteConfig(siteConfig)
            console.log('🎨 已更新用户站点配置:', siteConfig)
          }

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

      // 修改密码 - 简化版，不需要原密码
      changePassword: async (newPassword) => {
        try {
          const response = await apiClient.put('/auth/password', {
            newPassword  // 只传新密码，后端会自动处理
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

      // 刷新令牌 - 改进版，使用新的时间解析
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

          // 使用改进的时间解析
          const tokenExpiresAt = get().parseExpiresIn(expiresIn)

          set({
            accessToken,
            tokenExpiresAt
          })

          // 更新默认请求头
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          console.log('🔄 Token刷新成功，新过期时间:', tokenExpiresAt?.toLocaleString())
          return accessToken
        } catch (error) {
          console.error('Token刷新失败:', error)
          // 停止自动刷新
          tokenRefreshService.stopAutoRefresh()
          // 刷新失败，执行登出
          get().logout()
          throw error
        }
      },

      // 发送邮箱验证码
      sendEmailCode: async (email) => {
        try {
          const response = await apiClient.post('/auth/send-email-code', { email })
          console.log('📧 验证码发送成功')
          return { success: true, message: response.data.message }
        } catch (error) {
          console.error('发送验证码失败:', error)
          const message = error.response?.data?.message || '发送验证码失败'
          return { success: false, message }
        }
      },

      // 邮箱验证码登录
      loginByEmailCode: async (email, code) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login-by-code', { email, code })
          const { 
            user, 
            permissions = [], 
            siteConfig,
            accessToken, 
            refreshToken, 
            expiresIn 
          } = response.data.data

          // 使用改进的时间解析
          const tokenExpiresAt = get().parseExpiresIn(expiresIn)

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

          // 更新站点配置（如果有）
          if (siteConfig) {
            useSystemConfigStore.getState().setUserSiteConfig(siteConfig)
            console.log('🎨 已更新用户站点配置:', siteConfig)
          }

          // 清理之前用户的聊天数据
          if (window.useChatStore) {
            const chatStore = window.useChatStore.getState()
            if (chatStore && chatStore.reset) {
              console.log('🧹 清除之前的聊天数据...')
              chatStore.reset()
            }
          }

          // 启动Token自动刷新
          tokenRefreshService.startAutoRefresh({ getState: get })

          console.log('✅ 验证码登录成功:', {
            user: user.email,
            role: user.role,
            permissions: permissions.length,
            tokenExpires: tokenExpiresAt?.toLocaleString(),
            hasSiteConfig: !!siteConfig
          })

          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ 验证码登录失败:', error)
          throw error
        }
      },

      // 邮箱+密码+验证码登录
      loginByEmailPassword: async (email, password, code) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login-by-email-password', { 
            email, 
            password, 
            code 
          })
          const { 
            user, 
            permissions = [], 
            siteConfig,
            accessToken, 
            refreshToken, 
            expiresIn 
          } = response.data.data

          // 使用改进的时间解析
          const tokenExpiresAt = get().parseExpiresIn(expiresIn)

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

          // 更新站点配置（如果有）
          if (siteConfig) {
            useSystemConfigStore.getState().setUserSiteConfig(siteConfig)
            console.log('🎨 已更新用户站点配置:', siteConfig)
          }

          // 清理之前用户的聊天数据
          if (window.useChatStore) {
            const chatStore = window.useChatStore.getState()
            if (chatStore && chatStore.reset) {
              console.log('🧹 清除之前的聊天数据...')
              chatStore.reset()
            }
          }

          // 启动Token自动刷新
          tokenRefreshService.startAutoRefresh({ getState: get })

          console.log('✅ 邮箱密码验证码登录成功:', {
            user: user.email,
            role: user.role,
            permissions: permissions.length,
            tokenExpires: tokenExpiresAt?.toLocaleString(),
            hasSiteConfig: !!siteConfig
          })

          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ 邮箱密码验证码登录失败:', error)
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

      // 初始化认证状态 - 改进版，支持自动刷新
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
            // 刷新成功后启动自动刷新
            tokenRefreshService.startAutoRefresh({ getState: get })
          } catch (error) {
            console.error('Token刷新失败，需要重新登录')
            return
          }
        } else {
          // Token未过期，启动自动刷新
          tokenRefreshService.startAutoRefresh({ getState: get })
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

// 在开发环境下暴露到window对象方便调试
if (process.env.NODE_ENV === 'development') {
  window.useAuthStore = useAuthStore
}

export default useAuthStore
