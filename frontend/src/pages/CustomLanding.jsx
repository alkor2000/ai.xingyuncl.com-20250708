/**
 * 自定义首页展示组件 - 修改登录按钮文字
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Spin, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { LoginOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import apiClient from '../utils/api'
import useAuthStore from '../stores/authStore'

const CustomLanding = () => {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
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
          setContent('')
        }
      } else {
        // 显示默认页面
        setContent('')
      }
    } catch (error) {
      console.error('加载自定义首页失败:', error)
      // 出错时显示默认页面
      setContent('')
    } finally {
      setLoading(false)
    }
  }

  // 默认页面内容
  const getDefaultContent = () => {
    return `
      <!DOCTYPE html>
      <html lang="${i18n.language}">
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
          <h1>${t('landing.title')}</h1>
          <p>${t('landing.description')}</p>
        </div>
      </body>
      </html>
    `
  }

  // The shipped bilingual template has separate language nodes. Remove only its
  // known duplicate English copy in Chinese mode; preserve scripts, links and media.
  const displayContent = useMemo(() => {
    if (!content || !i18n.language.startsWith('zh')) return content
    const page = new DOMParser().parseFromString(content, 'text/html')
    const heading = page.querySelector('.hero-subtitle')
    if (heading?.textContent.trim() !== 'AI Model Application Platform') return content
    const chineseHeading = page.querySelector('.hero-subtitle-zh')
    if (chineseHeading) {
      heading.textContent = chineseHeading.textContent
      chineseHeading.remove()
    }
    page.querySelectorAll('.badge-en, .hero-description').forEach(node => node.remove())
    page.querySelectorAll('.cta-buttons .btn-text').forEach(node => {
      if (['Get Started', 'Learn More'].includes(node.textContent.trim())) node.remove()
    })
    const systemInfo = '系统特性：\n\n• 多模型人工智能对话\n• 智能文档处理\n• 图像生成与分析\n• 流式响应\n• 积分管理\n• 多用户权限管理\n\n点击“立即开始”登录体验！'
    page.querySelectorAll('script').forEach(script => {
      script.textContent = script.textContent.replace(
        /alert\('AI Platform Features \/ 系统特性：[^']*'\)/,
        `alert(${JSON.stringify(systemInfo)})`
      )
    })
    page.documentElement.lang = 'zh-CN'
    page.title = '人工智能模型应用平台'
    return page.documentElement.outerHTML
  }, [content, i18n.language])

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
          {t('button.login')}
        </Button>
      )}

      {/* 自定义内容iframe */}
      <iframe
        title={t('landing.frameTitle')}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          margin: 0,
          padding: 0
        }}
        srcDoc={displayContent || getDefaultContent()}
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
      />
    </div>
  )
}

export default CustomLanding
