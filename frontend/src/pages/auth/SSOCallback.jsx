/**
 * SSO 单点登录回调页面
 *
 * 职责：
 *   接收第三方平台重定向带来的 token，完成本平台登录态建立后跳转。
 *
 * 流程：
 *   1. 从 URL 参数读取 token（accessToken）与可选的 refreshToken
 *   2. 写入 localStorage（authStore 使用的 auth-storage 键）
 *   3. 设置 axios 默认 Authorization 头
 *   4. 调 /auth/me 拉取用户信息 → 更新 authStore 登录态
 *   5. 跳转到目标页（默认 /dashboard）
 *
 * 对接 URL 格式：
 *   /auth/sso-callback?token={accessToken}&refreshToken={refreshToken}
 *
 * 本页面是"中转页"，用户只会短暂经过。这里只展示极简加载态
 * （居中转圈 + 一行小字），不展示成功弹窗、不做人为停留延迟，
 * 拿到用户信息后立即跳转，让 SSO 跳转尽量无感。
 * 仅在出错时（token 缺失 / 无效）才展示错误信息并跳回登录页。
 *
 * ===== v1.1 国际化改造要点（务必理解，勿回退）=====
 *
 * 1. 【最关键】useEffect 内绝对不能调用 t()
 *    原因：一旦在 useEffect 内使用 t，就必须把 t 加入依赖数组；
 *    而 t 在语言切换时是新的函数引用，会导致 useEffect 重新执行，
 *    进而【重复调用 /auth/me、重复执行 navigate 跳转】。
 *    对登录中转页来说这是严重副作用（可能造成重复登录请求或跳转抖动）。
 *
 *    因此改为：
 *      - 自己抛出的错误在 Error 对象上挂 i18nKey 字段
 *      - catch 后转换为 { key, detail } 结构存入 state
 *      - 只在渲染层（JSX）才调用 t(error.key)
 *    这样 useEffect 依赖数组保持 [searchParams, navigate] 不变，
 *    同时用户在错误页停留期间切换语言，文案能即时跟随。
 *
 * 2. 原代码 setError(err.message || 'SSO登录失败') 把中文文本存进 state，
 *    即使加上 t() 也无法响应语言切换（state 里已是求值后的字符串）。
 *
 * 3. console.error 属开发者日志而非界面文案，改用英文，
 *    避免服务器/浏览器控制台在不同环境下的编码问题。
 *
 * 4. Error 对象的 message 保留英文技术描述（供日志排查），
 *    界面展示一律走 i18nKey，两者职责分离。
 */

import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import apiClient from '../../utils/api'

/* 出错后自动跳回登录页的延迟（给用户时间看到错误提示） */
const ERROR_REDIRECT_DELAY_MS = 2500

/* localStorage 中 authStore 持久化使用的键名，与 authStore 的 persist 配置一致 */
const AUTH_STORAGE_KEY = 'auth-storage'

/* SSO 未指定 redirect 时的默认落地页 */
const DEFAULT_REDIRECT = '/dashboard'

const SSOCallback = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()

  /**
   * 错误状态结构：{ key: 'i18n键', detail: '技术细节(可选)' }
   *
   * 刻意不存已翻译的文本：
   * 若存字符串，用户在这个页面停留期间切换语言，界面不会更新。
   * 存 key 则每次渲染都重新 t()，语言切换即时生效。
   */
  const [error, setError] = useState(null)

  useEffect(() => {
    const handleSSOCallback = async () => {
      try {
        /* 从 URL 参数获取 token 与跳转目标 */
        const token = searchParams.get('token')
        const redirect = searchParams.get('redirect') || DEFAULT_REDIRECT

        if (!token) {
          /**
           * 在 Error 上挂 i18nKey，而不是把中文写进 message。
           * message 保留英文技术描述供 console 与日志系统使用。
           */
          const err = new Error('SSO callback failed: missing token parameter')
          err.i18nKey = 'auth.sso.errorNoToken'
          throw err
        }

        /* refreshToken 可选，缺失时退回使用 accessToken（与原逻辑一致） */
        const refreshToken = searchParams.get('refreshToken') || token

        /* 写入 localStorage，供页面刷新后 authStore 恢复登录态 */
        const authData = {
          accessToken: token,
          refreshToken,
          isAuthenticated: true
        }
        const existingData = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}')
        const updatedData = {
          ...existingData,
          state: {
            ...existingData.state,
            ...authData
          }
        }
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedData))

        /* 设置 axios 默认请求头，供紧接着的 /auth/me 调用携带 */
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`

        /* 拉取用户信息以完成登录态建立 */
        const response = await apiClient.get('/auth/me')
        if (!response.data?.success) {
          const err = new Error('SSO callback failed: unable to fetch user info')
          err.i18nKey = 'auth.sso.errorFetchUser'
          throw err
        }

        const { user, permissions, siteConfig } = response.data.data

        /* 更新 authStore 登录态 */
        useAuthStore.setState({
          user,
          permissions: permissions || [],
          accessToken: token,
          refreshToken,
          isAuthenticated: true,
          loading: false
        })

        /* 更新站点配置（支持组级覆盖站点名/Logo） */
        if (siteConfig) {
          const systemConfigStore = await import('../../stores/systemConfigStore')
          systemConfigStore.default.getState().setUserSiteConfig(siteConfig)
        }

        /* 立即跳转，不做人为延迟、不展示成功画面 */
        navigate(redirect, { replace: true })

      } catch (err) {
        /* 开发者日志用英文，与界面文案职责分离 */
        console.error('[SSOCallback] handle callback failed:', err)

        /**
         * 转换为 { key, detail } 结构：
         * - 我们自己抛的错带 i18nKey，detail 留空（message 是英文技术描述，无需给用户看）
         * - 意外错误（网络异常等）用通用 key，把原始 message 作为 detail 附加，便于排障
         */
        setError({
          key: err.i18nKey || 'auth.sso.errorFailed',
          detail: err.i18nKey ? '' : (err.message || '')
        })

        /* 短暂展示错误信息后跳回登录页 */
        setTimeout(() => {
          navigate('/login', { replace: true })
        }, ERROR_REDIRECT_DELAY_MS)
      }
    }

    handleSSOCallback()
    /**
     * 依赖数组刻意只含 searchParams 与 navigate。
     * 绝不可加入 t —— 否则语言切换会重跑整个 SSO 流程。
     */
  }, [searchParams, navigate])

  /* ============ 出错态：极简错误提示 + 自动跳回登录页 ============ */
  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 20,
          color: '#ff4d4f'
        }}
      >
        {/* 主提示走 i18n，语言切换即时生效 */}
        <div style={{ fontSize: 16 }}>{t(error.key)}</div>

        {/* 技术细节小字附加（仅意外错误时有值），属排障信息不翻译 */}
        {error.detail && (
          <div style={{ fontSize: 12, color: '#bbb' }}>{error.detail}</div>
        )}

        <div style={{ fontSize: 13, color: '#999' }}>
          {t('auth.sso.redirectingToLogin')}
        </div>
      </div>
    )
  }

  /* ============ 加载态：居中转圈 + 一行小字，正常情况一闪而过 ============ */
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16
      }}
    >
      <Spin size="large" />
      <div style={{ fontSize: 14, color: '#999' }}>
        {t('auth.sso.loggingIn')}
      </div>
    </div>
  )
}

export default SSOCallback
