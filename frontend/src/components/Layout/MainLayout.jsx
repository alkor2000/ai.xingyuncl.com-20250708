import React from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Layout,
  Menu,
  Dropdown,
  Avatar,
  Button,
  Space,
  Badge,
  Tooltip
} from 'antd'
import {
  DashboardOutlined,
  MessageOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  BellOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import useAuthStore from '../../stores/authStore'

const { Header, Sider, Content } = Layout

const MainLayout = ({ children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, hasPermission } = useAuthStore()
  const [collapsed, setCollapsed] = React.useState(false)

  // 菜单项配置
  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: '工作台',
      permission: null
    },
    {
      key: '/chat',
      icon: <MessageOutlined />,
      label: 'AI对话',
      permission: 'chat.use'
    },
    {
      key: 'admin',
      icon: <SettingOutlined />,
      label: '系统管理',
      permission: 'user.manage',
      children: [
        {
          key: '/admin/users',
          label: '用户管理',
          permission: 'user.manage'
        },
        {
          key: '/admin/settings',
          label: '系统设置',
          permission: 'system.all'
        }
      ]
    }
  ]

  // 过滤菜单项（根据权限）
  const filterMenuItems = (items) => {
    return items.filter(item => {
      if (item.permission && !hasPermission(item.permission)) {
        return false
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
  const handleMenuClick = ({ key }) => {
    if (key !== 'admin') {
      navigate(key)
    }
  }

  // 用户下拉菜单
  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人信息',
      onClick: () => navigate('/profile')
    },
    {
      type: 'divider'
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => handleLogout()
    }
  ]

  // 处理登出
  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 侧边栏 */}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="light"
        width={240}
        style={{
          boxShadow: '2px 0 8px rgba(0, 0, 0, 0.06)',
          zIndex: 100
        }}
      >
        {/* Logo区域 */}
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? 0 : '0 24px',
          borderBottom: '1px solid #f0f0f0',
          fontWeight: 'bold',
          fontSize: 18,
          color: '#1890ff'
        }}>
          {collapsed ? 'AI' : 'AI Platform'}
        </div>

        {/* 菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={location.pathname.includes('/admin') ? ['admin'] : []}
          items={filteredMenuItems}
          onClick={handleMenuClick}
          style={{ border: 'none', paddingTop: 16 }}
        />
      </Sider>

      <Layout>
        {/* 顶部导航 */}
        <Header style={{
          padding: '0 24px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: '16px', width: 40, height: 40 }}
            />
          </div>

          <div>
            <Space size="middle">
              {/* 通知图标 */}
              <Tooltip title="通知">
                <Badge count={0} size="small">
                  <Button 
                    type="text" 
                    icon={<BellOutlined />} 
                    shape="circle"
                    size="large"
                  />
                </Badge>
              </Tooltip>

              {/* 用户信息 */}
              <Dropdown 
                menu={{ items: userMenuItems }}
                placement="bottomRight"
                arrow
              >
                <Space style={{ cursor: 'pointer' }}>
                  <Avatar 
                    size="small" 
                    icon={<UserOutlined />}
                    src={user?.avatar_url}
                  />
                  <span>
                    {user?.username || user?.email}
                  </span>
                </Space>
              </Dropdown>
            </Space>
          </div>
        </Header>

        {/* 内容区域 */}
        <Content style={{ 
          margin: 0, 
          background: '#f5f5f5',
          overflow: 'auto',
          height: 'calc(100vh - 64px)',
          padding: '24px'
        }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
