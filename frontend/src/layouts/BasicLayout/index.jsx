import React, { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout } from 'antd'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import useStatsStore from '../../stores/statsStore'
import Header from './Header'
import Sidebar from './Sidebar'
import MobileDrawer from './MobileDrawer'
import './style.css'

const { Content } = Layout

const BasicLayout = ({ children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, hasPermission, hasRole } = useAuthStore()
  const { initializeSocket, disconnectSocket } = useStatsStore()
  const { t } = useTranslation()
  
  // 移动端菜单状态
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false)
  
  // 响应式检测
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])

  // 初始化WebSocket连接
  useEffect(() => {
    initializeSocket()
    
    return () => {
      disconnectSocket()
    }
  }, [initializeSocket, disconnectSocket])

  // 菜单配置
  const menuItems = [
    {
      key: '/',
      icon: 'DashboardOutlined',
      label: t('nav.dashboard'),
      permission: null
    },
    {
      key: '/chat',
      icon: 'MessageOutlined',
      label: t('nav.chat'),
      permission: 'chat.use'
    },
    {
      key: 'admin',
      icon: 'SettingOutlined',
      label: t('nav.admin'),
      permission: ['user.manage', 'user.manage.group'],
      children: [
        {
          key: '/admin/users',
          label: t('nav.users'),
          permission: ['user.manage', 'user.manage.group']
        },
        {
          key: '/admin/settings',
          label: t('nav.settings'),
          roles: ['super_admin', 'admin'],
          permission: null
        }
      ]
    }
  ]

  // 过滤菜单项
  const filterMenuItems = (items) => {
    return items.filter(item => {
      if (item.roles) {
        const hasRequiredRole = item.roles.some(role => hasRole(role))
        if (!hasRequiredRole) return false
      }
      
      if (item.permission) {
        if (Array.isArray(item.permission)) {
          const hasAnyPermission = item.permission.some(p => hasPermission(p))
          if (!hasAnyPermission) return false
        } else {
          if (!hasPermission(item.permission)) return false
        }
      }
      
      if (item.children) {
        item.children = filterMenuItems(item.children)
        return item.children.length > 0
      }
      
      return true
    })
  }

  const filteredMenuItems = filterMenuItems(menuItems)

  // 处理菜单点击
  const handleMenuClick = (key) => {
    if (key !== 'admin') {
      navigate(key)
      // 移动端点击后关闭菜单
      if (isMobile) {
        setMobileMenuVisible(false)
      }
    }
  }

  return (
    <Layout className="basic-layout">
      {/* 顶部导航栏 - 横向拉通 */}
      <Header 
        isMobile={isMobile}
        onMenuClick={() => setMobileMenuVisible(true)}
      />
      
      {/* 主体布局 */}
      <Layout className="basic-layout-body">
        {/* PC端侧边栏 */}
        {!isMobile && (
          <Sidebar
            menuItems={filteredMenuItems}
            selectedKey={location.pathname}
            onMenuClick={handleMenuClick}
          />
        )}
        
        {/* 移动端抽屉菜单 */}
        {isMobile && (
          <MobileDrawer
            visible={mobileMenuVisible}
            menuItems={filteredMenuItems}
            selectedKey={location.pathname}
            onClose={() => setMobileMenuVisible(false)}
            onMenuClick={handleMenuClick}
          />
        )}
        
        {/* 内容区域 */}
        <Content className="basic-layout-content">
          {children || <Outlet />}
        </Content>
      </Layout>
    </Layout>
  )
}

export default BasicLayout
