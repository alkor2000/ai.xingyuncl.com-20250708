/**
 * 认证状态管理
 * 
 * 职责：
 * 1. 管理用户认证状态（登录/登出/Token刷新）
 * 2. 4种登录方式（密码/验证码/邮箱密码验证码/SSO）
 * 3. 用户信息/权限/积分查询
 * 4. Token自动刷新和持久化
 * 
 * 修复：
 * - changePassword 增加 oldPassword 参数，配合后端原密码验证
 * - 提取 _handleLoginSuccess 消除三个登录方法的重复代码
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient from '../utils/api'
import useSystemConfigStore from './systemConfigStore'
import tokenRefreshService from '../services/tokenRefreshService'

/**
 * 登录成功后的统一处理逻辑（内部函数）
 * 提取自 login/loginByEmailCode/loginByEmailPassword 三个方法的公共部分
 * 
 * @param {Function} set - Zustand set 函数
 * @param {Function} get - Zustand get 函数
 * @param {Object} responseData - API 响应中的 data 字段
 * @param {string} loginMethod - 登录方式描述（用于日志）
 */
const _handleLoginSuccess = (set, get, responseData, loginMethod = '登录') => {
  const {
    user,
    permissions = [],
    siteConfig,
    accessToken,
    refreshToken,
    expiresIn
  } = responseData

  // 解析Token过期时间
  const tokenExpiresAt = get().parseExpiresIn(expiresIn)

  // 更新认证状态
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

  // 更新站点配置（支持组级覆盖）
  if (siteConfig) {
    useSystemConfigStore.getState().setUserSiteConfig(siteConfig)
    console.log('🎨 已更新用户站点配置:', siteConfig)
  }

  // 清理之前用户的聊天数据，防止数据串用户
  try {
    const { default: useChatStore } = require('./chatStore')
    if (useChatStore) {
      const chatStore = useChatStore.getState()
      if (chatStore && chatStore.reset) {
        console.log('🧹 清除之前的聊天数据...')
        chatStore.reset()
      }
    }
  } catch (e) {
    // chatStore 可能还没加载，不影响登录流程
    console.warn('清理聊天数据跳过:', e.message)
  }

  // 启动Token自动刷新
  tokenRefreshService.startAutoRefresh({ getState: get })

  console.log(`✅ ${loginMethod}成功:`, {
    user: user.email,
    role: user.role,
    permissions: permissions.length,
    tokenExpires: tokenExpiresAt?.toLocaleString(),
    hasSiteConfig: !!siteConfig
  })
}

const useAuthStore = create(
  persist(
    (set, get) => ({
      // ============================================================
      // 状态
      // ============================================================
      user: null,
      permissions: [],
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      loading: false,
      tokenExpiresAt: null,

      // ============================================================
      // 工具方法
      // ============================================================

      /**
       * 解析过期时间字符串（支持 s/m/h/d 格式）
       * @param {string} expiresIn - 如 '24h', '30d', '3600s'
       * @returns {Date|null} 过期时间点
       */
      parseExpiresIn: (expiresIn) => {
        if (!expiresIn) return null

        const match = expiresIn.match(/^(\d+)([smhd])$/i)
        if (!match) {
          const seconds = parseInt(expiresIn)
          if (isNaN(seconds)) return null
          return new Date(Date.now() + seconds * 1000)
        }

        const [, num, unit] = match
        const value = parseInt(num)
        let milliseconds = 0

        switch (unit.toLowerCase()) {
          case 's': milliseconds = value * 1000; break
          case 'm': milliseconds = value * 60 * 1000; break
          case 'h': milliseconds = value * 60 * 60 * 1000; break
          case 'd': milliseconds = value * 24 * 60 * 60 * 1000; break
          default: return null
        }

        return new Date(Date.now() + milliseconds)
      },

      // ============================================================
      // 登录方法
      // ============================================================

      /**
       * 密码登录（用户名/邮箱/手机号 + 密码）
       */
      login: async (credentials) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login', credentials)
          _handleLoginSuccess(set, get, response.data.data, '密码登录')
          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ 登录失败:', error)
          throw error
        }
      },

      /**
       * 邮箱验证码登录
       */
      loginByEmailCode: async (email, code) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login-by-code', { email, code })
          _handleLoginSuccess(set, get, response.data.data, '验证码登录')
          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ 验证码登录失败:', error)
          throw error
        }
      },

      /**
       * 邮箱+密码+验证码登录（强制验证模式）
       */
      loginByEmailPassword: async (email, password, code) => {
        set({ loading: true })
        try {
          const response = await apiClient.post('/auth/login-by-email-password', {
            email, password, code
          })
          _handleLoginSuccess(set, get, response.data.data, '邮箱密码验证码登录')
          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ 邮箱密码验证码登录失败:', error)
          throw error
        }
      },

      // ============================================================
      // 登出
      // ============================================================

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

          // 清除认证状态
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

          // 清除聊天数据
          try {
            const { default: useChatStore } = require('./chatStore')
            if (useChatStore) {
              const chatStore = useChatStore.getState()
              if (chatStore && chatStore.reset) {
                console.log('🧹 清除聊天数据...')
                chatStore.reset()
              }
            }
          } catch (e) {
            console.warn('清理聊天数据跳过:', e.message)
          }

          console.log('🚪 用户已登出')

          // 跳转到首页
          window.location.href = '/'
        }
      },

      // ============================================================
      // 用户信息管理
      // ============================================================

      /**
       * 获取当前用户信息
       */
      getCurrentUser: async () => {
        try {
          const response = await apiClient.get('/auth/me')
          const { user, permissions = [], siteConfig } = response.data.data

          set({
            user,
            permissions: permissions || []
          })

          if (siteConfig) {
            useSystemConfigStore.getState().setUserSiteConfig(siteConfig)
            console.log('🎨 已更新用户站点配置:', siteConfig)
          }

          console.log('👤 用户信息已更新')
          return response.data
        } catch (error) {
          console.error('获取用户信息失败:', error)
          if (error.response?.status === 401) {
            get().logout()
          }
          throw error
        }
      },

      /**
       * 更新个人信息
       */
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

      /**
       * 修改密码 - 必须提供原密码
       * 
       * 安全说明：即使用户已通过JWT认证，修改密码仍需验证原密码
       * 防止 token 被盗后攻击者永久接管账号
       * 
       * @param {string} oldPassword - 原密码
       * @param {string} newPassword - 新密码
       */
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

      /**
       * 获取积分历史
       */
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

      // ============================================================
      // 注册与验证
      // ============================================================

      /**
       * 用户注册
       */
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
          const msg = error.response?.data?.message || '注册失败'
          return { success: false, message: msg }
        }
      },

      /**
       * 检查邮箱是否可用
       */
      checkEmailAvailable: async (email) => {
        try {
          const response = await apiClient.post('/auth/check-email', { email })
          return response.data.data.available
        } catch (error) {
          return false
        }
      },

      /**
       * 检查用户名是否可用
       */
      checkUsernameAvailable: async (username) => {
        try {
          const response = await apiClient.post('/auth/check-username', { username })
          return response.data.data.available
        } catch (error) {
          return false
        }
      },

      /**
       * 发送邮箱验证码
       */
      sendEmailCode: async (email) => {
        try {
          const response = await apiClient.post('/auth/send-email-code', { email })
          console.log('📧 验证码发送成功')
          return { success: true, message: response.data.message }
        } catch (error) {
          console.error('发送验证码失败:', error)
          const msg = error.response?.data?.message || '发送验证码失败'
          return { success: false, message: msg }
        }
      },

      // ============================================================
      // Token管理
      // ============================================================

      /**
       * 刷新访问令牌
       */
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
          const tokenExpiresAt = get().parseExpiresIn(expiresIn)

          set({ accessToken, tokenExpiresAt })
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

          console.log('🔄 Token刷新成功，新过期时间:', tokenExpiresAt?.toLocaleString())
          return accessToken
        } catch (error) {
          console.error('Token刷新失败:', error)
          tokenRefreshService.stopAutoRefresh()
          get().logout()
          throw error
        }
      },

      // ============================================================
      // 权限检查
      // ============================================================

      /**
       * 检查是否拥有指定权限
       */
      hasPermission: (permission) => {
        const { permissions } = get()
        return permissions.includes(permission) ||
               permissions.includes('system.all') ||
               permissions.some(p => p.endsWith('.*') && permission.startsWith(p.slice(0, -1)))
      },

      /**
       * 检查是否拥有指定角色
       */
      hasRole: (role) => {
        const { user } = get()
        if (!user) return false
        if (Array.isArray(role)) {
          return role.includes(user.role)
        }
        return user.role === role
      },

      /**
       * 检查Token是否过期
       */
      isTokenExpired: () => {
        const { tokenExpiresAt } = get()
        if (!tokenExpiresAt) return true
        return new Date() >= new Date(tokenExpiresAt)
      },

      // ============================================================
      // 初始化
      // ============================================================

      /**
       * 初始化认证状态（应用启动时调用）
       */
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
            tokenRefreshService.startAutoRefresh({ getState: get })
          } catch (error) {
            console.error('Token刷新失败，需要重新登录')
            return
          }
        } else {
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
        console.log('🔄 恢复认证状态...')
        if (state?.accessToken) {
          state.initializeAuth()
        }
      }
    }
  )
)

// 开发环境暴露到window方便调试
if (process.env.NODE_ENV === 'development') {
  window.useAuthStore = useAuthStore
}

export default useAuthStore
