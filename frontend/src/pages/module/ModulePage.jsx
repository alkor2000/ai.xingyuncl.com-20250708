/**
 * 模块页面 - 用于展示外部应用
 */

import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Spin, Result, Button } from 'antd'
import { LoadingOutlined, ReloadOutlined } from '@ant-design/icons'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'
import './ModulePage.less'

const ModulePage = () => {
  const { moduleName } = useParams()
  const navigate = useNavigate()
  const { modules, getUserModules } = useAdminStore()  // 使用getUserModules
  const { accessToken } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [module, setModule] = useState(null)
  const [iframeError, setIframeError] = useState(false)

  // 构建带token的URL
  const buildModuleUrl = (baseUrl) => {
    if (!baseUrl || !accessToken) return baseUrl
    
    // 检查URL是否已有查询参数
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}token=${encodeURIComponent(accessToken)}`
  }

  // 加载模块信息
  useEffect(() => {
    const loadModule = async () => {
      try {
        setLoading(true)
        
        let modulesList = modules
        
        // 如果modules为空，则加载并使用返回值
        if (!modules || modules.length === 0) {
          modulesList = await getUserModules()  // 使用getUserModules替代getModules
        }
        
        // 查找对应的模块
        const foundModule = modulesList.find(m => m.name === moduleName)
        if (foundModule) {
          setModule(foundModule)
          setIframeError(false)
        } else {
          setModule(null)
        }
      } catch (error) {
        console.error('加载模块失败:', error)
        setModule(null)
      } finally {
        setLoading(false)
      }
    }

    loadModule()
  }, [moduleName, getUserModules])  // 更新依赖

  // 处理iframe加载完成
  const handleIframeLoad = () => {
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
    // 强制刷新iframe
    const iframe = document.getElementById('module-iframe')
    if (iframe) {
      iframe.src = buildModuleUrl(module.module_url)
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

  // 添加调试日志
  console.log('Module URL:', module.module_url)
  console.log('Access Token:', accessToken ? 'Present' : 'Missing')
  console.log('Final iframe URL:', buildModuleUrl(module.module_url))

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
              <Button key="back" onClick={() => navigate('/')}>
                返回首页
              </Button>
            ]}
          />
        </div>
      )}
      
      {!iframeError && (
        <iframe
          id="module-iframe"
          src={buildModuleUrl(module.module_url)}
          title={module.display_name}
          className="module-iframe"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          allow="camera; microphone; fullscreen; payment"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"
        />
      )}
    </div>
  )
}

export default ModulePage
