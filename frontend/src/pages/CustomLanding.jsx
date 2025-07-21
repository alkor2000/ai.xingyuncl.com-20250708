/**
 * 自定义首页展示组件
 */

import React, { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import apiClient from '../utils/api'

const CustomLanding = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')

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
          // 如果未启用或没有内容，跳转到登录页
          navigate('/login')
        }
      } else {
        navigate('/login')
      }
    } catch (error) {
      console.error('加载自定义首页失败:', error)
      navigate('/login')
    } finally {
      setLoading(false)
    }
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
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0 }}>
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
