import React, { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import useAuthStore from './stores/authStore'

// 页面组件（使用正确的路径）
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Dashboard from './pages/dashboard/Dashboard'
import Chat from './pages/chat/Chat'
import UserManagement from './pages/admin/Users'
import Settings from './pages/admin/Settings'

// 布局组件
import MainLayout from './components/Layout/MainLayout'

// 路由守卫组件
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuthStore()
  
  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        加载中...
      </div>
    )
  }
  
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

const PublicRoute = ({ children }) => {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <Navigate to="/" replace /> : children
}

function App() {
  const { initializeAuth } = useAuthStore()

  useEffect(() => {
    try {
      initializeAuth()
    } catch (error) {
      console.error('初始化认证状态失败:', error)
    }
  }, [initializeAuth])

  return (
    <ConfigProvider locale={zhCN}>
      <Router>
        <div className="app">
          <Routes>
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
                  <MainLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/chat" element={<Chat />} />
                      <Route path="/admin/users" element={<UserManagement />} />
                      <Route path="/admin/settings" element={<Settings />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </MainLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </Router>
    </ConfigProvider>
  )
}

export default App
