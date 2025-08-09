import React, { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout } from 'antd'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import useStatsStore from '../../stores/statsStore'
import useModuleStore from '../../stores/moduleStore'
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
  const { userModules, getUserModules } = useModuleStore()
  const { t } = useTranslation()
  
  // 移动端菜单状态
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false)
  
  // 响应式检测
  const [isMobile, setIsMobile] = useState(false)
  
  // 动态菜单项
  const [dynamicMenuItems, setDynamicMenuItems] = useState([])
  
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

  // 加载用户可访问的模块
  useEffect(() => {
    if (user) {
      getUserModules()
    }
  }, [user, getUserModules])

  // 构建菜单项（从后端获取的模块数据）
  useEffect(() => {
    if (!userModules || userModules.length === 0) {
      // 如果还没有加载模块，设置一个基础菜单
      setDynamicMenuItems([])
      return
    }

    // 将模块分类：系统模块和外部模块
    const systemModules = userModules.filter(m => m.module_category === 'system')
    const externalModules = userModules.filter(m => m.module_category === 'external')
    
    // 构建菜单结构
    const menuItems = []
    
    // 1. 添加系统模块（工作台、聊天、万智台、图像生成等）
    // 分离管理模块和普通系统模块
    const adminModules = systemModules.filter(m => m.name.startsWith('admin_'))
    const normalSystemModules = systemModules.filter(m => !m.name.startsWith('admin_'))
    
    // 按sort_order排序
    normalSystemModules.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    
    // 处理所有非管理的系统模块
    normalSystemModules.forEach(module => {
      // 设置权限
      let permission = null
      if (module.name === 'chat' || module.name === 'knowledge') {
        permission = 'chat.use'
      }
      
      // 添加菜单项
      menuItems.push({
        key: module.route_path || `/${module.name}`,
        icon: module.menu_icon || 'AppstoreOutlined',
        label: module.display_name || module.name,
        permission: permission,
        isSystemModule: true,
        moduleData: module
      })
    })
    
    // 2. 添加外部模块
    externalModules.forEach(module => {
      menuItems.push({
        key: `/module/${module.name}`,
        icon: module.menu_icon || 'AppstoreOutlined',
        label: module.display_name,
        permission: null,
        isModule: true,
        openMode: module.open_mode,
        moduleUrl: module.module_url,
        moduleData: module
      })
    })
    
    // 3. 构建管理菜单（包含用户管理和系统设置）
    const adminChildren = []
    
    // 查找用户管理模块
    const adminUsersModule = adminModules.find(m => m.name === 'admin_users')
    if (adminUsersModule) {
      adminChildren.push({
        key: adminUsersModule.route_path || '/admin/users',
        label: adminUsersModule.display_name || t('nav.users'),
        permission: ['user.manage', 'user.manage.group'],
        isSystemModule: true,
        moduleData: adminUsersModule
      })
    }
    
    // 查找系统设置模块
    const adminSettingsModule = adminModules.find(m => m.name === 'admin_settings')
    if (adminSettingsModule) {
      adminChildren.push({
        key: adminSettingsModule.route_path || '/admin/settings',
        label: adminSettingsModule.display_name || t('nav.settings'),
        roles: ['super_admin', 'admin'],
        permission: null,
        isSystemModule: true,
        moduleData: adminSettingsModule
      })
    }
    
    // 如果有管理子菜单，添加管理菜单组
    if (adminChildren.length > 0) {
      menuItems.push({
        key: 'admin',
        icon: 'SettingOutlined',
        label: t('nav.admin'),
        permission: ['user.manage', 'user.manage.group'],
        children: adminChildren
      })
    }
    
    setDynamicMenuItems(menuItems)
  }, [userModules, t])

  // 过滤菜单项（基于权限）
  const filterMenuItems = (items) => {
    return items.filter(item => {
      // 模块菜单项已经过滤过了，直接显示
      if (item.isModule || item.isSystemModule) {
        return true
      }
      
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

  const filteredMenuItems = filterMenuItems(dynamicMenuItems)

  // 处理菜单点击
  const handleMenuClick = (key, menuItem) => {
    // 如果是外部模块且设置为新标签页打开
    if (menuItem?.isModule && menuItem?.openMode === 'new_tab') {
      window.open(menuItem.moduleUrl, '_blank')
      return
    }
    
    // 如果是系统模块或其他路由
    if (key !== 'admin') {
      navigate(key)
      // 移动端点击后关闭菜单
      if (isMobile) {
        setMobileMenuVisible(false)
      }
    }
  }

  // 查找菜单项
  const findMenuItem = (items, key) => {
    for (const item of items) {
      if (item.key === key) {
        return item
      }
      if (item.children) {
        const found = findMenuItem(item.children, key)
        if (found) return found
      }
    }
    return null
  }

  // 修改点击处理
  const handleMenuClickWrapper = (key) => {
    const menuItem = findMenuItem(filteredMenuItems, key)
    handleMenuClick(key, menuItem)
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
            onMenuClick={handleMenuClickWrapper}
          />
        )}
        
        {/* 移动端抽屉菜单 */}
        {isMobile && (
          <MobileDrawer
            visible={mobileMenuVisible}
            menuItems={filteredMenuItems}
            selectedKey={location.pathname}
            onClose={() => setMobileMenuVisible(false)}
            onMenuClick={handleMenuClickWrapper}
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
