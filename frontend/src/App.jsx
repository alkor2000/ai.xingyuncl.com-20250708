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
import Dashboard from './pages/dashboard/Dashboard'
import Chat from './pages/chat/Chat'
import Profile from './pages/profile/Profile'
import CustomLanding from './pages/CustomLanding'

// Admin页面组件 - 懒加载隔离管理功能
const UserManagement = React.lazy(() => import('./pages/admin/Users'))
const Settings = React.lazy(() => import('./pages/admin/Settings'))

// 模块页面组件 - 懒加载
const ModulePage = React.lazy(() => import('./pages/module/ModulePage'))

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

// 优化的首页路由组件 - 移除自定义首页检查，直接跳转
const HomeRoute = () => {
  const { isAuthenticated } = useAuthStore()

  // 已登录，跳转到工作台
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  // 未登录，跳转到登录页
  return <Navigate to="/login" replace />
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
              {/* 根路径 - 简化逻辑，直接跳转 */}
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
