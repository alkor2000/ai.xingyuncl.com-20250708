/**
 * 应用主入口组件
 * 
 * 功能说明：
 * 1. 路由配置和权限控制
 * 2. 全局主题和国际化配置
 * 3. 系统配置初始化（包括默认语言）
 * 
 * 版本更新：
 * - v1.2.0 (2025-01-07): 添加系统默认语言初始化支持
 */

import React, { Suspense, useEffect, useState } from 'react'
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate 
} from 'react-router-dom'
import { ConfigProvider, Spin, message } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import './styles/ios-unified-theme.css';
import { useTranslation } from 'react-i18next'
import useAuthStore from './stores/authStore'
import useSystemConfigStore from './stores/systemConfigStore'
import apiClient from './utils/api'
import { setSystemDefaultLanguage, hasUserSelectedLanguage } from './utils/i18n'

// 导入主题Provider
import ThemeProvider from './components/ThemeProvider'

// 页面组件
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import OrgApplication from './pages/auth/OrgApplication'
import SSOCallback from './pages/auth/SSOCallback'
import Dashboard from './pages/dashboard/Dashboard'
import Chat from './pages/chat/Chat'
import Profile from './pages/profile/Profile'
import CustomLanding from './pages/CustomLanding'

// Admin页面组件 - 懒加载隔离管理功能
const UserManagement = React.lazy(() => import('./pages/admin/Users'))
const Settings = React.lazy(() => import('./pages/admin/Settings'))
const Analytics = React.lazy(() => import('./pages/admin/Analytics'))

// 模块页面组件 - 懒加载
const ModulePage = React.lazy(() => import('./pages/module/ModulePage'))

// 知识库页面组件 - 懒加载
const KnowledgeBase = React.lazy(() => import('./pages/knowledge/KnowledgeBase'))

// 图像生成页面组件 - 懒加载
const ImageGeneration = React.lazy(() => import('./pages/image/ImageGeneration'))

// 视频生成页面组件 - 懒加载
const VideoGeneration = React.lazy(() => import('./pages/video/VideoGeneration'))

// HTML编辑器页面组件 - 懒加载
const HtmlEditor = React.lazy(() => import('./pages/htmlEditor/HtmlEditor'))

// 文件管理页面组件 - 懒加载
const StorageManager = React.lazy(() => import('./pages/storage/StorageManager'))

// 思维导图页面组件 - 懒加载
const Mindmap = React.lazy(() => import('./pages/mindmap/Mindmap'))

// OCR页面组件 - 懒加载
const OcrTool = React.lazy(() => import('./pages/ocr/OcrTool'))

// 日历页面组件 - 懒加载
const Calendar = React.lazy(() => import('./pages/calendar/Calendar'))

// Agent工作流主工作区 - 懒加载
const AgentWorkspace = React.lazy(() => import('./pages/agent/AgentWorkspace'))

// Agent工作流编辑器 - 懒加载
const WorkflowEditor = React.lazy(() => import('./pages/agent/editor/WorkflowEditor'))

// 智能教学系统页面组件 - 懒加载
const Teaching = React.lazy(() => import('./pages/teaching/Teaching'))
const ModuleDetail = React.lazy(() => import('./pages/teaching/ModuleDetail'))
const LessonDetail = React.lazy(() => import('./pages/teaching/LessonDetail'))
const LessonEditor = React.lazy(() => import('./pages/teaching/LessonEditor'))
const LessonViewer = React.lazy(() => import('./pages/teaching/LessonViewer'))

// 智能应用广场 - 懒加载
const SmartApps = React.lazy(() => import('./pages/smartApps/SmartApps'))

// 知识库模块 - 懒加载（新增）
const Wiki = React.lazy(() => import('./pages/wiki/Wiki'))

// 布局组件
import BasicLayout from './layouts/BasicLayout'

// 懒加载Loading组件
const LazyLoadingWrapper = ({ children }) => (
  <Suspense fallback={
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '60vh',
      flexDirection: 'column',
      gap: '16px'
    }}>
      <Spin size="large" tip="加载模块中..." />
      <div style={{ color: '#666', fontSize: '14px' }}>
        正在加载管理功能...
      </div>
    </div>
  }>
    {children}
  </Suspense>
)

// 路由守卫组件
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuthStore()
  const { initSystemConfig } = useSystemConfigStore()
  const { t } = useTranslation()
  
  // 初始化系统配置
  useEffect(() => {
    if (isAuthenticated) {
      initSystemConfig()
    }
  }, [isAuthenticated, initSystemConfig])
  
  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <Spin size="large" tip={t('status.loading')} />
      </div>
    )
  }
  
  if (!isAuthenticated) {
    message.warning(t('auth.loginRequired'))
    return <Navigate to="/login" replace />
  }
  
  return children
}

// 公开路由组件
const PublicRoute = ({ children }) => {
  const { isAuthenticated } = useAuthStore()
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }
  
  return children
}

// 优化的首页路由组件
const HomeRoute = () => {
  const { isAuthenticated } = useAuthStore()

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return <CustomLanding />
}

const App = () => {
  const { i18n } = useTranslation()
  const currentLanguage = i18n.language
  const locale = currentLanguage === 'zh-CN' ? zhCN : enUS
  
  // 系统默认语言初始化状态
  const [languageInitialized, setLanguageInitialized] = useState(false)
  
  // 获取系统配置
  const { systemConfig, initialized, getSiteLogo, getSiteDescription } = useSystemConfigStore()

  // 全局消息配置
  useEffect(() => {
    message.config({
      top: 80,
      duration: 3,
      maxCount: 3,
    })
  }, [])
  
  /**
   * 初始化系统默认语言
   * 在应用启动时从公开API获取系统默认语言配置
   * 仅当用户没有主动选择过语言时才应用
   */
  useEffect(() => {
    const initDefaultLanguage = async () => {
      // 如果用户已经主动选择过语言，不需要获取系统默认语言
      if (hasUserSelectedLanguage()) {
        console.log('🌐 用户已有语言偏好，跳过系统默认语言')
        setLanguageInitialized(true)
        return
      }
      
      try {
        // 从公开API获取系统配置
        const response = await apiClient.get('/public/system-config')
        
        if (response.data?.success && response.data?.data) {
          const defaultLanguage = response.data.data.site?.default_language
          
          if (defaultLanguage) {
            // 应用系统默认语言
            setSystemDefaultLanguage(defaultLanguage)
            console.log('✅ 系统默认语言已应用:', defaultLanguage)
          }
        }
      } catch (error) {
        // 获取失败不影响应用运行，使用i18n的默认检测逻辑
        console.warn('⚠️ 获取系统默认语言配置失败，使用默认检测:', error.message)
      } finally {
        setLanguageInitialized(true)
      }
    }
    
    initDefaultLanguage()
  }, [])
  
  // 动态更新浏览器标签栏的favicon和title
  useEffect(() => {
    if (!initialized) return
    
    try {
      const logoUrl = getSiteLogo()
      if (logoUrl) {
        const faviconLink = document.getElementById('favicon-link') || 
                           document.querySelector("link[rel*='icon']")
        
        if (faviconLink) {
          faviconLink.href = logoUrl
          console.log('✅ Favicon已更新:', logoUrl)
        } else {
          const newLink = document.createElement('link')
          newLink.id = 'favicon-link'
          newLink.rel = 'icon'
          newLink.type = 'image/png'
          newLink.href = logoUrl
          document.head.appendChild(newLink)
          console.log('✅ Favicon已创建并更新:', logoUrl)
        }
      }
      
      const siteDescription = getSiteDescription()
      if (siteDescription && siteDescription !== '企业级AI应用聚合平台') {
        document.title = siteDescription
        console.log('✅ 页面标题已更新:', siteDescription)
      }
    } catch (error) {
      console.error('❌ 更新favicon或title失败:', error)
    }
  }, [initialized, systemConfig, getSiteLogo, getSiteDescription])

  return (
    <ConfigProvider locale={locale}>
      <ThemeProvider>
        <Router>
          <div className="app">
            <Routes>
              {/* 根路径 */}
              <Route path="/" element={<HomeRoute />} />

              {/* 公开路由 */}
              <Route 
                path="/login" 
                element={
                  <PublicRoute>
                    <Login />
                  </PublicRoute>
                } 
              />
              <Route 
                path="/register" 
                element={
                  <PublicRoute>
                    <Register />
                  </PublicRoute>
                } 
              />
              <Route 
                path="/org-application" 
                element={
                  <PublicRoute>
                    <OrgApplication />
                  </PublicRoute>
                } 
              />
              
              {/* SSO回调路由 */}
              <Route 
                path="/auth/sso-callback" 
                element={<SSOCallback />} 
              />

              {/* 受保护的路由 */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <BasicLayout>
                      <Routes>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/chat" element={<Chat />} />
                        <Route path="/profile" element={<Profile />} />
                        
                        {/* 智能应用广场路由 */}
                        <Route 
                          path="/smart-apps" 
                          element={
                            <LazyLoadingWrapper>
                              <SmartApps />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 知识库页面路由 */}
                        <Route 
                          path="/knowledge" 
                          element={
                            <LazyLoadingWrapper>
                              <KnowledgeBase />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 知识库模块路由（新增）*/}
                        <Route 
                          path="/wiki" 
                          element={
                            <LazyLoadingWrapper>
                              <Wiki />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 图像生成页面路由 */}
                        <Route 
                          path="/image" 
                          element={
                            <LazyLoadingWrapper>
                              <ImageGeneration />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 视频生成页面路由 */}
                        <Route 
                          path="/video" 
                          element={
                            <LazyLoadingWrapper>
                              <VideoGeneration />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* HTML编辑器页面路由 */}
                        <Route 
                          path="/html-editor" 
                          element={
                            <LazyLoadingWrapper>
                              <HtmlEditor />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 文件管理页面路由 */}
                        <Route 
                          path="/storage" 
                          element={
                            <LazyLoadingWrapper>
                              <StorageManager />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 思维导图页面路由 */}
                        <Route 
                          path="/mindmap" 
                          element={
                            <LazyLoadingWrapper>
                              <Mindmap />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* OCR页面路由 */}
                        <Route 
                          path="/ocr" 
                          element={
                            <LazyLoadingWrapper>
                              <OcrTool />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 日历页面路由 */}
                        <Route 
                          path="/calendar" 
                          element={
                            <LazyLoadingWrapper>
                              <Calendar />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* Agent工作流路由 */}
                        <Route 
                          path="/agent" 
                          element={
                            <LazyLoadingWrapper>
                              <AgentWorkspace />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* Agent工作流编辑器路由 */}
                        <Route 
                          path="/agent/editor/:id" 
                          element={
                            <LazyLoadingWrapper>
                              <WorkflowEditor />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 智能教学系统路由 */}
                        <Route 
                          path="/teaching" 
                          element={
                            <LazyLoadingWrapper>
                              <Teaching />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 教学模块详情路由 */}
                        <Route 
                          path="/teaching/modules/:id" 
                          element={
                            <LazyLoadingWrapper>
                              <ModuleDetail />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 课程详情路由 */}
                        <Route 
                          path="/teaching/lessons/:id" 
                          element={
                            <LazyLoadingWrapper>
                              <LessonDetail />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 课程页面查看路由 */}
                        <Route 
                          path="/teaching/lessons/:id/pages/:pageNumber" 
                          element={
                            <LazyLoadingWrapper>
                              <LessonViewer />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 课程编辑路由 */}
                        <Route 
                          path="/teaching/lessons/:id/edit" 
                          element={
                            <LazyLoadingWrapper>
                              <LessonEditor />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 模块页面路由 */}
                        <Route 
                          path="/module/:moduleName" 
                          element={
                            <LazyLoadingWrapper>
                              <ModulePage />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* Admin路由 */}
                        <Route 
                          path="/admin/users" 
                          element={
                            <LazyLoadingWrapper>
                              <UserManagement />
                            </LazyLoadingWrapper>
                          } 
                        />
                        <Route 
                          path="/admin/settings" 
                          element={
                            <LazyLoadingWrapper>
                              <Settings />
                            </LazyLoadingWrapper>
                          } 
                        />
                        <Route 
                          path="/admin/analytics" 
                          element={
                            <LazyLoadingWrapper>
                              <Analytics />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                      </Routes>
                    </BasicLayout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </div>
        </Router>
      </ThemeProvider>
    </ConfigProvider>
  )
}

export default App
