import React from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import MainLayout from '../layout/MainLayout'
import AuthLayout from '../layout/AuthLayout'
import Login from '../pages/auth/Login'
import Register from '../pages/auth/Register'
import Dashboard from '../pages/dashboard/Dashboard'
import Chat from '../pages/chat/Chat'
import Profile from '../pages/profile/Profile'
import Users from '../pages/admin/Users'
import Settings from '../pages/admin/Settings'
import NotFound from '../pages/error/NotFound'
import ProtectedRoute from '../components/ProtectedRoute'
import useAuthStore from '../stores/authStore'

const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <AuthLayout>
        <Login />
      </AuthLayout>
    )
  },
  {
    path: '/register',
    element: (
      <AuthLayout>
        <Register />
      </AuthLayout>
    )
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />
      },
      {
        path: 'dashboard',
        element: <Dashboard />
      },
      {
        path: 'chat',
        element: <Chat />
      },
      {
        path: 'profile',
        element: <Profile />
      },
      {
        path: 'admin',
        children: [
          {
            path: 'users',
            element: (
              <ProtectedRoute permissions={['user.manage']}>
                <Users />
              </ProtectedRoute>
            )
          },
          {
            path: 'settings',
            element: (
              <ProtectedRoute permissions={['system.all']}>
                <Settings />
              </ProtectedRoute>
            )
          }
        ]
      }
    ]
  },
  {
    path: '*',
    element: <NotFound />
  }
])

export default router
