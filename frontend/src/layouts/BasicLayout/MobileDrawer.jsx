import React from 'react'
import { Drawer, Menu } from 'antd'
import * as Icons from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const MobileDrawer = ({ visible, menuItems, selectedKey, onClose, onMenuClick }) => {
  const { t } = useTranslation()
  
  // 动态获取图标组件
  const getIcon = (iconName) => {
    const Icon = Icons[iconName]
    return Icon ? <Icon /> : null
  }

  // 转换菜单配置为Ant Design Menu所需格式
  const convertMenuItems = (items) => {
    return items.map(item => {
      const menuItem = {
        key: item.key,
        icon: item.icon ? getIcon(item.icon) : null,
        label: item.label
      }
      
      if (item.children) {
        menuItem.children = convertMenuItems(item.children)
      }
      
      return menuItem
    })
  }

  const antdMenuItems = convertMenuItems(menuItems)

  // 获取默认展开的菜单keys
  const getDefaultOpenKeys = () => {
    if (selectedKey?.includes('/admin')) {
      return ['admin']
    }
    return []
  }

  return (
    <Drawer
      title={
        <div className="mobile-drawer-header">
          <span className="logo-icon">AI</span>
          <span className="logo-text">{t('app.name')}</span>
        </div>
      }
      placement="left"
      onClose={onClose}
      open={visible}
      width={280}
      className="mobile-menu-drawer"
      bodyStyle={{ padding: 0 }}
    >
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        defaultOpenKeys={getDefaultOpenKeys()}
        items={antdMenuItems}
        onClick={({ key }) => {
          onMenuClick(key)
          onClose()
        }}
        className="mobile-menu"
      />
    </Drawer>
  )
}

export default MobileDrawer
