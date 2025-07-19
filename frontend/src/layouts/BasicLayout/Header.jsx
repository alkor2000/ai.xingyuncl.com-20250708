import React from 'react'
import { Layout, Space, Badge, Avatar, Dropdown, Button } from 'antd'
import {
  MenuOutlined,
  UserOutlined,
  LogoutOutlined,
  BellOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import LanguageSwitch from '../../components/common/LanguageSwitch'

const { Header: AntHeader } = Layout

const Header = ({ isMobile, onMenuClick }) => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user, logout } = useAuthStore()

  // 用户下拉菜单
  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('nav.profile'),
      onClick: () => navigate('/profile')
    },
    {
      type: 'divider'
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('nav.logout'),
      onClick: handleLogout
    }
  ]

  // 处理登出
  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <AntHeader className="basic-layout-header">
      <div className="header-left">
        {/* 移动端菜单按钮 */}
        {isMobile && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={onMenuClick}
            className="mobile-menu-trigger"
          />
        )}
        
        {/* Logo和系统名称 */}
        <div className="header-logo" onClick={() => navigate('/')}>
          <span className="logo-icon">AI</span>
          <span className="logo-text">{t('app.name')}</span>
        </div>
      </div>

      <div className="header-right">
        <Space size="middle">
          {/* 语言切换 */}
          <LanguageSwitch />
          
          {/* 通知图标（暂时隐藏在移动端） */}
          {!isMobile && (
            <Badge count={0} size="small">
              <Button 
                type="text" 
                icon={<BellOutlined />} 
                shape="circle"
              />
            </Badge>
          )}

          {/* 用户信息 */}
          <Dropdown 
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            arrow
          >
            <Space className="user-info" style={{ cursor: 'pointer' }}>
              <Avatar 
                size="small" 
                icon={<UserOutlined />}
                src={user?.avatar_url}
              />
              {!isMobile && (
                <span className="user-name">
                  {user?.username || user?.email}
                </span>
              )}
            </Space>
          </Dropdown>
        </Space>
      </div>
    </AntHeader>
  )
}

export default Header
