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
import OrgApplication from './pages/auth/OrgApplication'  // 新增企业申请页面
import SSOCallback from './pages/auth/SSOCallback'  // 新增SSO回调页面
import Dashboard from './pages/dashboard/Dashboard'
import Chat from './pages/chat/Chat'
import Profile from './pages/profile/Profile'
import CustomLanding from './pages/CustomLanding'

// Admin页面组件 - 懒加载隔离管理功能
const UserManagement = React.lazy(() => import('./pages/admin/Users'))
const Settings = React.lazy(() => import('./pages/admin/Settings'))
const Analytics = React.lazy(() => import('./pages/admin/Analytics')) // 新增数据分析页面

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

// 布局组件 - 使用新的BasicLayout
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

// 优化的首页路由组件 - 显示自定义首页
const HomeRoute = () => {
  const { isAuthenticated } = useAuthStore()

  // 已登录，跳转到工作台
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  // 未登录，显示自定义首页
  return <CustomLanding />
}

const App = () => {
  const { i18n } = useTranslation()
  const currentLanguage = i18n.language
  const locale = currentLanguage === 'zh-CN' ? zhCN : enUS

  // 全局消息配置
  useEffect(() => {
    message.config({
      top: 80,
      duration: 3,
      maxCount: 3,
    })
  }, [])

  return (
    <ConfigProvider locale={locale}>
      <ThemeProvider>
        <Router>
          <div className="app">
            <Routes>
              {/* 根路径 - 显示自定义首页或跳转到dashboard */}
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
              
              {/* SSO回调路由 - 不需要PublicRoute包装，因为它会处理自己的认证逻辑 */}
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
                        
                        {/* 知识库页面路由 - 懒加载 */}
                        <Route 
                          path="/knowledge" 
                          element={
                            <LazyLoadingWrapper>
                              <KnowledgeBase />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 图像生成页面路由 - 懒加载 */}
                        <Route 
                          path="/image" 
                          element={
                            <LazyLoadingWrapper>
                              <ImageGeneration />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 视频生成页面路由 - 懒加载 */}
                        <Route 
                          path="/video" 
                          element={
                            <LazyLoadingWrapper>
                              <VideoGeneration />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* HTML编辑器页面路由 - 懒加载 */}
                        <Route 
                          path="/html-editor" 
                          element={
                            <LazyLoadingWrapper>
                              <HtmlEditor />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 文件管理页面路由 - 懒加载 */}
                        <Route 
                          path="/storage" 
                          element={
                            <LazyLoadingWrapper>
                              <StorageManager />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* 模块页面路由 - 懒加载 */}
                        <Route 
                          path="/module/:moduleName" 
                          element={
                            <LazyLoadingWrapper>
                              <ModulePage />
                            </LazyLoadingWrapper>
                          } 
                        />
                        
                        {/* Admin路由 - 懒加载隔离 */}
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
