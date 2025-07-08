import React from 'react'
import { Navigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

const AuthLayout = ({ children }) => {
  const { isAuthenticated } = useAuthStore()

  // 如果已经认证，重定向到主页
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="auth-container">
      {children}
    </div>
  )
}

export default AuthLayout
