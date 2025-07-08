import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import useAuthStore from '../stores/authStore'

const ProtectedRoute = ({ children, permissions = [], roles = [] }) => {
  const location = useLocation()
  const { 
    isAuthenticated, 
    loading, 
    hasPermission, 
    hasRole 
  } = useAuthStore()

  // 如果正在加载，显示loading
  if (loading) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center' 
      }}>
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  // 如果未认证，跳转到登录页
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // 检查权限
  if (permissions.length > 0) {
    const hasRequiredPermissions = permissions.every(permission => 
      hasPermission(permission)
    )
    
    if (!hasRequiredPermissions) {
      return (
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <h2>权限不足</h2>
          <p>您没有访问此页面的权限</p>
        </div>
      )
    }
  }

  // 检查角色
  if (roles.length > 0) {
    const hasRequiredRole = hasRole(roles)
    
    if (!hasRequiredRole) {
      return (
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <h2>角色权限不足</h2>
          <p>您的角色无法访问此页面</p>
        </div>
      )
    }
  }

  return children
}

export default ProtectedRoute
