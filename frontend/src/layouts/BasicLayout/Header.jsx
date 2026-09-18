import React from 'react'
import { Layout, Space, Badge, Dropdown, Button } from 'antd'
import {
  MenuOutlined,
  UserOutlined,
  LogoutOutlined,
  BellOutlined,
  HomeOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import useSystemConfigStore from '../../stores/systemConfigStore'
import LanguageSwitch from '../../components/common/LanguageSwitch'

const { Header: AntHeader } = Layout

const Header = ({ isMobile, onMenuClick }) => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user, logout } = useAuthStore()
  const { getSiteName, getSiteLogo, isUsingGroupConfig } = useSystemConfigStore()

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

  const siteName = getSiteName()
  const siteLogo = getSiteLogo()
  const usingGroupConfig = isUsingGroupConfig()

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
          {/* 显示Logo - 组Logo或系统Logo */}
          {siteLogo ? (
            <img 
              src={siteLogo} 
              alt={siteName}
              className="logo-image"
              style={{
                height: '32px',
                width: 'auto',
                objectFit: 'contain',
                marginRight: '8px'
              }}
            />
          ) : (
            <img src="/portal-logo.png" alt="" width={32} height={32} style={{ objectFit: 'contain', borderRadius: 8, flexShrink: 0, marginRight: 8 }} />
          )}
          <span className="logo-text">{siteName}</span>
        </div>
      </div>

      <div className="header-right">
        <Space size="middle">
          {!isMobile && <Button href="https://id.pkuailab.com/portal/return/ai-practice" target="_self" rel="noopener noreferrer" icon={<HomeOutlined />}>{t('nav.returnPortal')}</Button>}
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

          {/* 用户信息 - 移除头像，只显示用户名 */}
          <Dropdown 
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            arrow
          >
            <Space className="user-info" style={{ cursor: 'pointer' }}>
              <UserOutlined style={{ fontSize: '16px', color: '#666' }} />
              <span className="user-name">
                {user?.username || user?.email}
              </span>
            </Space>
          </Dropdown>
        </Space>
      </div>
    </AntHeader>
  )
}

export default Header
