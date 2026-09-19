/**
 * 自定义首页展示组件 - 修改登录按钮文字
 */

import React, { useEffect, useState } from 'react'
import { Spin, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { LoginOutlined } from '@ant-design/icons'
import apiClient from '../utils/api'
import useAuthStore from '../stores/authStore'

const CustomLanding = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  // 获取认证状态
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    loadCustomHomepage()
  }, [])

  const loadCustomHomepage = async () => {
    try {
      const response = await apiClient.get('/public/custom-homepage')
      
      if (response.data.success && response.data.data) {
        const { enabled, content } = response.data.data
        
        if (enabled && content) {
          setContent(content)
        } else {
          // 如果未启用或没有内容，显示默认页面
          setContent(getDefaultContent())
        }
      } else {
        // 显示默认页面
        setContent(getDefaultContent())
      }
    } catch (error) {
      console.error('加载自定义首页失败:', error)
      // 出错时显示默认页面
      setContent(getDefaultContent())
    } finally {
      setLoading(false)
    }
  }

  // 默认页面内容
  const getDefaultContent = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            height: 100vh;
            background: #f7f5f2;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .welcome-container {
            text-align: center;
            color: #272525;
            padding: 40px;
          }
          h1 {
            font-size: clamp(28px, 5vw, 48px);
            margin-bottom: 20px;
            font-weight: 650;
            animation: fadeIn 1s ease-in;
          }
          p {
            font-size: 20px;
            opacity: 0.9;
            color: #65615f;
            animation: fadeIn 1.5s ease-in;
          }
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        </style>
      </head>
      <body>
        <div class="welcome-container">
          <img src="/portal-logo.png" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:16px;margin-bottom:24px" />
          <h1>Welcome to AI Platform</h1>
          <p>Enterprise AI Application Platform</p>
        </div>
      </body>
      </html>
    `
  }

  // 处理Login按钮点击
  const handleLogin = () => {
    navigate('/login')
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh'
      }}>
        <Spin size="large" />
      </div>
    )
  }

  // 使用iframe显示内容，确保安全隔离
  return (
    <div className="custom-landing" style={{ width: '100%', height: '100vh', margin: 0, padding: 0, position: 'relative' }}>
      {/* Login按钮 - 固定在右上角，只在未登录时显示 */}
      {!isAuthenticated && (
        <Button
          type="primary"
          icon={<LoginOutlined />}
          onClick={handleLogin}
          className="landing-login"
        >
          登录 / Login
        </Button>
      )}

      {/* 自定义内容iframe */}
      <iframe
        title="Custom Homepage"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          margin: 0,
          padding: 0
        }}
        srcDoc={content}
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      />
    </div>
  )
}

export default CustomLanding
