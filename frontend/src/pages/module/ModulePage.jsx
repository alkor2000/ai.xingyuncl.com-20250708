/**
 * 模块页面 - 支持JWT认证的外部应用展示
 */

import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Spin, Result, Button, message } from 'antd'
import { LoadingOutlined, ReloadOutlined, ExportOutlined } from '@ant-design/icons'
import useAdminStore from '../../stores/adminStore'
import apiClient from '../../utils/api'
import './ModulePage.less'

const ModulePage = () => {
  const { moduleName } = useParams()
  const navigate = useNavigate()
  const { modules, getUserModules } = useAdminStore()
  const [loading, setLoading] = useState(true)
  const [module, setModule] = useState(null)
  const [authUrl, setAuthUrl] = useState(null)
  const [iframeError, setIframeError] = useState(false)
  const formRef = useRef(null)
  const iframeRef = useRef(null)

  // 加载模块信息和认证URL
  useEffect(() => {
    const loadModuleAndAuth = async () => {
      try {
        setLoading(true)
        
        let modulesList = modules
        
        // 如果modules为空，则加载
        if (!modules || modules.length === 0) {
          modulesList = await getUserModules()
        }
        
        // 查找对应的模块
        const foundModule = modulesList.find(m => m.name === moduleName)
        if (!foundModule) {
          setModule(null)
          return
        }
        
        setModule(foundModule)
        
        // 获取认证URL
        const response = await apiClient.get(`/admin/modules/${foundModule.id}/auth-url`)
        const authInfo = response.data.data
        setAuthUrl(authInfo)
        
        // 如果是新标签页模式，直接打开
        if (foundModule.open_mode === 'new_tab') {
          handleNewTabOpen(authInfo)
        } else {
          // iframe模式
          handleIframeLoad(authInfo)
        }
        
      } catch (error) {
        console.error('加载模块失败:', error)
        message.error('加载模块失败')
        setModule(null)
      } finally {
        setLoading(false)
      }
    }

    loadModuleAndAuth()
  }, [moduleName, getUserModules])

  // 处理新标签页打开
  const handleNewTabOpen = (authInfo) => {
    if (!authInfo) return
    
    // 根据不同的认证方式处理
    if (authInfo.method === 'POST' && authInfo.formData) {
      // POST方式需要创建表单提交
      createAndSubmitForm(authInfo.url, authInfo.formData)
    } else if (authInfo.headers && Object.keys(authInfo.headers).length > 0) {
      // 如果有header，需要提示用户
      message.warning('该模块需要特殊认证方式，请联系管理员')
    } else {
      // GET方式或URL参数方式，直接打开
      window.open(authInfo.url, '_blank')
    }
    
    // 返回首页
    setTimeout(() => {
      navigate('/')
    }, 1000)
  }

  // 处理iframe加载
  const handleIframeLoad = (authInfo) => {
    if (!authInfo || !iframeRef.current) return
    
    if (authInfo.method === 'POST' && authInfo.formData) {
      // POST方式需要特殊处理
      createIframeForm(authInfo.url, authInfo.formData)
    } else if (authInfo.headers && authInfo.headers['Set-Cookie']) {
      // Cookie方式
      // 注意：由于浏览器限制，无法直接设置第三方cookie
      message.warning('Cookie认证方式可能存在兼容性问题')
      iframeRef.current.src = authInfo.url
    } else {
      // GET方式或URL参数方式
      iframeRef.current.src = authInfo.url
    }
  }

  // 创建并提交表单（新标签页）
  const createAndSubmitForm = (url, formData) => {
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = url
    form.target = '_blank'
    
    Object.keys(formData).forEach(key => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = key
      input.value = formData[key]
      form.appendChild(input)
    })
    
    document.body.appendChild(form)
    form.submit()
    document.body.removeChild(form)
  }

  // 创建iframe表单提交
  const createIframeForm = (url, formData) => {
    if (!formRef.current) return
    
    const form = formRef.current
    form.action = url
    form.method = 'POST'
    form.target = 'module-iframe'
    
    // 清空现有input
    form.innerHTML = ''
    
    // 添加新的input
    Object.keys(formData).forEach(key => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = key
      input.value = formData[key]
      form.appendChild(input)
    })
    
    form.submit()
  }

  // 处理iframe加载完成
  const handleIframeOnLoad = () => {
    setLoading(false)
  }

  // 处理iframe错误
  const handleIframeError = () => {
    setLoading(false)
    setIframeError(true)
  }

  // 重新加载
  const handleReload = () => {
    setLoading(true)
    setIframeError(false)
    if (authUrl && iframeRef.current) {
      handleIframeLoad(authUrl)
    }
  }

  // 在新标签页打开（从iframe模式切换）
  const handleOpenInNewTab = () => {
    if (authUrl) {
      handleNewTabOpen(authUrl)
    }
  }

  if (loading && !module) {
    return (
      <div className="module-page-loading">
        <Spin 
          size="large" 
          indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />}
          tip="加载模块中..."
        />
      </div>
    )
  }

  if (!module) {
    return (
      <div className="module-page-error">
        <Result
          status="404"
          title="模块未找到"
          subTitle="您访问的模块不存在或您没有访问权限"
          extra={
            <Button type="primary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>
    )
  }

  // 如果是新标签页模式，显示提示
  if (module.open_mode === 'new_tab') {
    return (
      <div className="module-page-redirect">
        <Result
          icon={<ExportOutlined style={{ fontSize: 72, color: '#1890ff' }} />}
          title={`正在打开 ${module.display_name}`}
          subTitle="模块将在新标签页中打开"
          extra={
            <Button type="primary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>
    )
  }

  // iframe模式
  return (
    <div className="module-page">
      {loading && (
        <div className="module-page-loading-overlay">
          <Spin 
            size="large"
            indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />}
            tip={`正在加载 ${module.display_name}...`}
          />
        </div>
      )}
      
      {iframeError && (
        <div className="module-page-error">
          <Result
            status="error"
            title="模块加载失败"
            subTitle={`无法加载 ${module.display_name}，请检查网络连接或稍后重试`}
            extra={[
              <Button key="retry" type="primary" icon={<ReloadOutlined />} onClick={handleReload}>
                重试
              </Button>,
              <Button key="newtab" onClick={handleOpenInNewTab}>
                在新标签页打开
              </Button>,
              <Button key="back" onClick={() => navigate('/')}>
                返回首页
              </Button>
            ]}
          />
        </div>
      )}
      
      {!iframeError && (
        <>
          {/* 隐藏的表单，用于POST方式提交 */}
          <form ref={formRef} style={{ display: 'none' }} />
          
          <iframe
            ref={iframeRef}
            id="module-iframe"
            name="module-iframe"
            title={module.display_name}
            className="module-iframe"
            onLoad={handleIframeOnLoad}
            onError={handleIframeError}
            allow="camera; microphone; fullscreen; payment"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"
          />
        </>
      )}
    </div>
  )
}

export default ModulePage
