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
 * 说明：
 *   本页面是一个"中转页"，用户只会短暂经过。这里只展示极简的加载态
 *   （一个居中的转圈 + 一行小字），不展示成功弹窗、不做人为停留延迟，
 *   拿到用户信息后立即跳转，让 SSO 跳转尽量无感。
 *   仅在出错时（token 缺失 / 无效）才展示错误信息并跳回登录页。
 */

import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Spin } from 'antd'
import useAuthStore from '../../stores/authStore'
import apiClient from '../../utils/api'

const SSOCallback = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // 仅用于区分"加载中"与"出错"两种展示，正常成功时不停留、直接跳转
  const [error, setError] = useState(null)

  useEffect(() => {
    const handleSSOCallback = async () => {
      try {
        // 从 URL 参数获取 token 与跳转目标
        const token = searchParams.get('token')
        const redirect = searchParams.get('redirect') || '/dashboard'

        if (!token) {
          throw new Error('SSO认证失败：缺少token参数')
        }

        // refreshToken 可选，缺失时退回使用 accessToken（与原逻辑一致）
        const refreshToken = searchParams.get('refreshToken') || token

        // 写入 localStorage（authStore 持久化使用的 auth-storage 键）
        const authData = {
          accessToken: token,
          refreshToken,
          isAuthenticated: true
        }
        const existingData = JSON.parse(localStorage.getItem('auth-storage') || '{}')
        const updatedData = {
          ...existingData,
          state: {
            ...existingData.state,
            ...authData
          }
        }
        localStorage.setItem('auth-storage', JSON.stringify(updatedData))

        // 设置 axios 默认请求头，供后续 /auth/me 调用携带
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`

        // 拉取用户信息以完成登录态建立
        const response = await apiClient.get('/auth/me')
        if (!response.data?.success) {
          throw new Error('获取用户信息失败')
        }

        const { user, permissions, siteConfig } = response.data.data

        // 更新 authStore 登录态
        useAuthStore.setState({
          user,
          permissions: permissions || [],
          accessToken: token,
          refreshToken,
          isAuthenticated: true,
          loading: false
        })

        // 更新站点配置（支持组级覆盖）
        if (siteConfig) {
          const systemConfigStore = await import('../../stores/systemConfigStore')
          systemConfigStore.default.getState().setUserSiteConfig(siteConfig)
        }

        // 立即跳转，不做人为延迟、不展示成功画面
        navigate(redirect, { replace: true })

      } catch (err) {
        console.error('SSO回调处理失败:', err)
        setError(err.message || 'SSO登录失败')

        // 出错时短暂展示错误信息后跳回登录页
        setTimeout(() => {
          navigate('/login', { replace: true })
        }, 2500)
      }
    }

    handleSSOCallback()
  }, [searchParams, navigate])

  // 出错态：展示极简错误提示
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
        <div style={{ fontSize: 16 }}>{error}</div>
        <div style={{ fontSize: 13, color: '#999' }}>即将跳转到登录页...</div>
      </div>
    )
  }

  // 加载态：极简居中转圈 + 一行小字，正常情况下一闪而过
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
      <div style={{ fontSize: 14, color: '#999' }}>正在登录...</div>
    </div>
  )
}

export default SSOCallback
