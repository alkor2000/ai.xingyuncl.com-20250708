/**
 * 认证状态管理
 * 
 * 职责：
 * 1. 管理用户认证状态（登录/登出/Token刷新）
 * 2. 4种登录方式（密码/验证码/邮箱密码验证码/SSO）
 * 3. 用户信息/权限/积分查询
 * 4. Token自动刷新和持久化
 * 
 * 修复记录：
 * - changePassword 增加 oldPassword 参数，配合后端原密码验证
 * - 提取 _handleLoginSuccess 消除三个登录方法的重复代码
 * - 2026-05-18: 修复 "require is not defined" 错误
 *   浏览器 ESM 环境没有 require()，改用顶部静态 import
 *   chatStore 没有反向引用 authStore，无循环依赖风险
 * - v1.1 国际化：本文件为非React模块（Zustand store），无法使用useTranslation hook，
 *   改为直接import i18n实例调用i18n.t()。
 *   全部console日志属开发者诊断信息（loginMethod也仅用于日志拼接），统一改英文不进语言包；
 *   2处error兜底文案改i18n.t()，一处新建auth.register.failed，一处复用既有auth.login.codeSendFailed（文案完全一致）；
 *   console.log调试对象中的toLocaleString()补传i18n.language消除硬编码locale
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient from '../utils/api'
import useSystemConfigStore from './systemConfigStore'
import tokenRefreshService from '../services/tokenRefreshService'
// 修复：使用 ESM 静态 import 替代 require('./chatStore')
import useChatStore from './chatStore'
import i18n from '../utils/i18n'

/**
 * 登录成功后的统一处理逻辑（内部函数）
 * 提取自 login/loginByEmailCode/loginByEmailPassword 三个方法的公共部分
 * 
 * @param {Function} set - Zustand set 函数
 * @param {Function} get - Zustand get 函数
 * @param {Object} responseData - API 响应中的 data 字段
 * @param {string} loginMethod - 登录方式描述（仅用于console.log调试输出，非用户可见）
 */
const _handleLoginSuccess = (set, get, responseData, loginMethod = 'Login') => {
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
    console.log('🎨 User site config updated:', siteConfig)
  }

  // 清理之前用户的聊天数据，防止数据串用户
  // 修复：改用顶部 import 的 useChatStore，不再使用 require
  try {
    if (useChatStore && typeof useChatStore.getState === 'function') {
      const chatStore = useChatStore.getState()
      if (chatStore && typeof chatStore.reset === 'function') {
        console.log('🧹 Clearing previous chat data...')
        chatStore.reset()
      }
    }
  } catch (e) {
    // 异常时不阻塞登录流程
    console.warn('Failed to clear chat data:', e.message)
  }

  // 启动Token自动刷新
  tokenRefreshService.startAutoRefresh({ getState: get })

  console.log(`✅ ${loginMethod} successful:`, {
    user: user.email,
    role: user.role,
    permissions: permissions.length,
    tokenExpires: tokenExpiresAt?.toLocaleString(i18n.language),
    hasSiteConfig: !!siteConfig
  })
}

/**
 * Identity登录后的return_to只接受后端Handoff返回的站内路径。
 */
const normalizeIdentityReturnTo = (value) => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/dashboard'
  }

  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    const code =
      value.charCodeAt(index)

    if (
      code < 0x20 ||
      code === 0x7F
    ) {
      return '/dashboard'
    }
  }

  return value
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
          _handleLoginSuccess(set, get, response.data.data, 'Password Login')
          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ Login failed:', error)
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
          _handleLoginSuccess(set, get, response.data.data, 'Code Login')
          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ Code login failed:', error)
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
          _handleLoginSuccess(set, get, response.data.data, 'Email+Password+Code Login')
          return response.data
        } catch (error) {
          set({ loading: false })
          console.error('❌ Email+password+code login failed:', error)
          throw error
        }
      },

      // ============================================================
      // PKU AI Lab统一身份登录
      // ============================================================

      /**
       * 消费Identity一次性Handoff。
       *
       * 后端返回本平台标准登录成功结构，
       * 继续复用_handleLoginSuccess建立唯一认证状态。
       */
      loginWithIdentityHandoff: async (handoff) => {
        set({
          loading: true
        })

        try {
          const response =
            await apiClient.post(
              '/auth/identity/login/consume',
              {
                handoff
              }
            )

          _handleLoginSuccess(
            set,
            get,
            response.data.data,
            'Identity Login'
          )

          const returnTo =
            normalizeIdentityReturnTo(
              response.headers?.[
                'x-identity-return-to'
              ]
            )

          return {
            response:
              response.data,
            returnTo
          }
        } catch (error) {
          set({
            loading: false
          })

          console.error(
            '❌ Identity login handoff failed:',
            error
          )

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
            console.log('📤 Logout API call successful')
          }
        } catch (error) {
          console.warn('Logout API call failed:', error)
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
          // 修复：改用顶部 import 的 useChatStore，不再使用 require
          try {
            if (useChatStore && typeof useChatStore.getState === 'function') {
              const chatStore = useChatStore.getState()
              if (chatStore && typeof chatStore.reset === 'function') {
                console.log('🧹 Clearing chat data...')
                chatStore.reset()
              }
            }
          } catch (e) {
            console.warn('Failed to clear chat data:', e.message)
          }

          console.log('🚪 User logged out')

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
            console.log('🎨 User site config updated:', siteConfig)
          }

          console.log('👤 User info updated')
          return response.data
        } catch (error) {
          console.error('Failed to get user info:', error)
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
          console.log('✅ Profile updated successfully')
          return response.data
        } catch (error) {
          console.error('Failed to update profile:', error)
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
          console.log('✅ Password changed successfully')
          return response.data
        } catch (error) {
          console.error('Failed to change password:', error)
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
          console.log('📊 Credit history fetched successfully')
          return response.data.data
        } catch (error) {
          console.error('Failed to get credit history:', error)
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
          console.log('✅ Registration successful')
          set({ loading: false })
          return { success: true, data: response.data }
        } catch (error) {
          set({ loading: false })
          console.error('❌ Registration failed:', error)
          const msg = error.response?.data?.message || i18n.t('auth.register.failed')
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
          console.log('📧 Verification code sent successfully')
          return { success: true, message: response.data.message }
        } catch (error) {
          console.error('Failed to send verification code:', error)
          const msg = error.response?.data?.message || i18n.t('auth.login.codeSendFailed')
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

          console.log('🔄 Token refreshed, new expiry:', tokenExpiresAt?.toLocaleString(i18n.language))
          return accessToken
        } catch (error) {
          console.error('Token refresh failed:', error)
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
          console.log('🔐 No access token, skipping initialization')
          return
        }

        // 设置默认请求头
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`

        // 检查Token是否过期
        if (state.isTokenExpired()) {
          console.log('⏰ Token expired, attempting refresh...')
          try {
            await state.refreshAccessToken()
            tokenRefreshService.startAutoRefresh({ getState: get })
          } catch (error) {
            console.error('Token refresh failed, re-login required')
            return
          }
        } else {
          tokenRefreshService.startAutoRefresh({ getState: get })
        }

        // 获取最新用户信息
        try {
          await state.getCurrentUser()
          console.log('✅ Auth state initialized successfully')
        } catch (error) {
          console.error('❌ Failed to get user info:', error)
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
        console.log('🔄 Restoring auth state...')
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
