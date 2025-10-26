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
import { useTranslation } from 'react-i18next'
import useAuthStore from './stores/authStore'
import useSystemConfigStore from './stores/systemConfigStore'

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
const LessonDetail = React.lazy(() => import('./pages/teaching/LessonDetail')) // 新增：课程详情（页面列表）
const LessonEditor = React.lazy(() => import('./pages/teaching/LessonEditor'))
const LessonViewer = React.lazy(() => import('./pages/teaching/LessonViewer'))

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
                        
                        {/* 知识库页面路由 */}
                        <Route 
                          path="/knowledge" 
                          element={
                            <LazyLoadingWrapper>
                              <KnowledgeBase />
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
                        
                        {/* 课程详情路由（新增：页面列表）*/}
                        <Route 
                          path="/teaching/lessons/:id" 
                          element={
                            <LazyLoadingWrapper>
                              <LessonDetail />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 课程页面查看路由（修改：支持 pageNumber）*/}
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
