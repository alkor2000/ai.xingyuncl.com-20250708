import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Spin, message } from 'antd'
import useAuthStore from '../../stores/authStore'
import apiClient from '../../utils/api'

const SSOCallback = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  useEffect(() => {
    const handleSSOCallback = async () => {
      try {
        // 从URL参数获取token
        const token = searchParams.get('token')
        const redirect = searchParams.get('redirect') || '/dashboard'
        
        if (!token) {
          throw new Error('SSO认证失败：缺少token参数')
        }
        
        console.log('SSO回调：收到token', { tokenLength: token.length, redirect })
        
        // 解析JWT token获取基本信息（不验证签名，仅用于显示）
        try {
          const payload = JSON.parse(atob(token.split('.')[1]))
          console.log('Token信息：', {
            userId: payload.userId,
            email: payload.email,
            username: payload.username,
            role: payload.role
          })
        } catch (e) {
          console.warn('无法解析token payload:', e)
        }
        
        // 方案1：直接使用token设置认证状态
        // 将token存储到localStorage并设置认证状态
        const authData = {
          accessToken: token,
          refreshToken: searchParams.get('refreshToken') || token, // 如果没有refreshToken，使用相同的token
          isAuthenticated: true
        }
        
        // 设置到localStorage（authStore使用的存储）
        const existingData = JSON.parse(localStorage.getItem('auth-storage') || '{}')
        const updatedData = {
          ...existingData,
          state: {
            ...existingData.state,
            ...authData
          }
        }
        localStorage.setItem('auth-storage', JSON.stringify(updatedData))
        
        // 设置默认请求头
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`
        
        // 获取用户信息以完成登录流程
        try {
          const response = await apiClient.get('/auth/me')
          if (response.data?.success) {
            const { user, permissions, siteConfig } = response.data.data
            
            // 更新authStore状态
            useAuthStore.setState({
              user,
              permissions: permissions || [],
              accessToken: token,
              refreshToken: authData.refreshToken,
              isAuthenticated: true,
              loading: false
            })
            
            // 如果有站点配置，更新它
            if (siteConfig) {
              const systemConfigStore = await import('../../stores/systemConfigStore')
              systemConfigStore.default.getState().setUserSiteConfig(siteConfig)
            }
            
            message.success('SSO登录成功')
            
            // 延迟跳转，让用户看到成功消息
            setTimeout(() => {
              navigate(redirect)
            }, 500)
          } else {
            throw new Error('获取用户信息失败')
          }
        } catch (userError) {
          console.error('获取用户信息失败:', userError)
          
          // 如果获取用户信息失败，可能token有问题，但还是尝试跳转
          // 因为ProtectedRoute会再次验证
          message.warning('SSO登录部分成功，正在跳转...')
          setTimeout(() => {
            navigate(redirect)
          }, 1000)
        }
        
      } catch (error) {
        console.error('SSO回调处理失败:', error)
        setError(error.message || 'SSO登录失败')
        message.error(error.message || 'SSO登录失败')
        
        // 3秒后跳转到登录页
        setTimeout(() => {
          navigate('/login')
        }, 3000)
      } finally {
        setLoading(false)
      }
    }
    
    handleSSOCallback()
  }, [searchParams, navigate])
  
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '40px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        textAlign: 'center',
        maxWidth: '400px',
        width: '100%'
      }}>
        {loading ? (
          <>
            <Spin size="large" />
            <h2 style={{ marginTop: '20px', color: '#333' }}>正在完成SSO登录...</h2>
            <p style={{ color: '#666' }}>请稍候，正在验证您的身份</p>
          </>
        ) : error ? (
          <>
            <h2 style={{ color: '#ff4d4f' }}>SSO登录失败</h2>
            <p style={{ color: '#666', marginTop: '10px' }}>{error}</p>
            <p style={{ color: '#999', fontSize: '14px', marginTop: '20px' }}>
              3秒后将跳转到登录页面...
            </p>
          </>
        ) : (
          <>
            <h2 style={{ color: '#52c41a' }}>SSO登录成功</h2>
            <p style={{ color: '#666', marginTop: '10px' }}>正在跳转...</p>
          </>
        )}
      </div>
      
      {/* 提示信息 */}
      <div style={{
        marginTop: '20px',
        padding: '15px',
        background: 'rgba(255, 255, 255, 0.9)',
        borderRadius: '4px',
        maxWidth: '400px',
        width: '100%'
      }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
          <strong>SSO集成说明：</strong>
        </p>
        <ul style={{ margin: '10px 0 0 20px', fontSize: '12px', color: '#999' }}>
          <li>第三方系统需要将用户重定向到此页面</li>
          <li>URL格式: /auth/sso-callback?token=xxx&redirect=/path</li>
          <li>token参数必须是有效的JWT令牌</li>
        </ul>
      </div>
    </div>
  )
}

export default SSOCallback
